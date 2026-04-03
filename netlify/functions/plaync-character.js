"use strict";

const AION2_BASE_URL = process.env.PLAYNC_AION2_BASE_URL || "https://aion2.plaync.com";
const AION2_SEARCH_PATH = "/ko-kr/api/search/aion2/search/v2/character";
const AION2_SERVERS_PATH = "/api/gameinfo/servers";
const AION2_PCDATA_PATH = "/api/gameinfo/pcdata";
const AION2_CHARACTER_INFO_PATH = "/api/character/info";
const SUPPORTED_PRODUCTS = new Set(["aion2"]);
const CACHE_TTL_MS = 1000 * 60 * 60;

const cache = {
  pcDataMap: {
    expiresAt: 0,
    value: null
  },
  servers: {
    expiresAt: 0,
    value: null
  }
};

exports.handler = async function handler(event) {
  const headers = createHeaders();

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const params = new URLSearchParams(event.queryStringParameters || {});
  const action = (params.get("action") || "search").trim();
  const product = (params.get("product") || "aion2").trim().toLowerCase();
  const keyword = (params.get("keyword") || "").trim();
  const server = (params.get("server") || "").trim();

  if (action !== "search") {
    return jsonResponse(400, { error: "지원하지 않는 action 입니다." }, headers);
  }

  if (!SUPPORTED_PRODUCTS.has(product)) {
    return jsonResponse(
      400,
      {
        error: "현재 이 프로젝트는 공식 공개 캐릭터 검색 경로가 확인된 AION2만 지원합니다."
      },
      headers
    );
  }

  if (!keyword) {
    return jsonResponse(400, { error: "keyword 파라미터가 필요합니다." }, headers);
  }

  try {
    const result = await searchAion2Characters({ keyword, server });
    return jsonResponse(200, result, headers);
  } catch (error) {
    return jsonResponse(
      Number.isInteger(error.statusCode) ? error.statusCode : 500,
      {
        error: error.message || "AION2 캐릭터 조회에 실패했습니다.",
        details: error.details || null
      },
      headers
    );
  }
};

async function searchAion2Characters({ keyword, server }) {
  const [servers, pcDataMap] = await Promise.all([
    getCachedServers(),
    getCachedPcDataMap()
  ]);

  const resolvedServer = resolveServer(server, servers);
  const payload = await requestAion2Json({
    path: AION2_SEARCH_PATH,
    query: {
      keyword,
      page: 1,
      size: 40,
      sort: "desc",
      serverId: resolvedServer?.serverId || ""
    }
  });

  const searchResults = Array.isArray(payload.list) ? payload.list : [];
  const normalizedCharacters = dedupeCharacters(
    searchResults
      .map((item) => normalizeAion2Character(item, pcDataMap))
      .filter(Boolean)
  );

  const sortedCharacters = sortCharacters(
    normalizedCharacters,
    keyword,
    resolvedServer?.serverId || ""
  );

  const characterInfoCache = new Map();
  const characters = await Promise.all(
    sortedCharacters.map((character) => enrichCharacterWithInfo(character, characterInfoCache))
  );

  return {
    characters: characters.map(stripInternalFields),
    meta: {
      count: characters.length,
      enrichedCount: characters.filter(
        (character) => character.combatPower !== null || character.itemLevel !== null
      ).length,
      product: "aion2",
      infoPath: AION2_CHARACTER_INFO_PATH,
      searchPath: AION2_SEARCH_PATH,
      server: resolvedServer
        ? {
            serverId: resolvedServer.serverId,
            serverName: resolvedServer.serverName || ""
          }
        : null
    }
  };
}

async function enrichCharacterWithInfo(character, characterInfoCache) {
  if (!character.characterId || !character.serverId) {
    return character;
  }

  const characterInfo = await getCharacterInfo({
    characterId: character.characterId,
    characterInfoCache,
    serverId: character.serverId
  });

  if (!characterInfo) {
    return character;
  }

  return {
    ...character,
    className: characterInfo.className || character.className,
    combatPower: characterInfo.combatPower,
    itemLevel: characterInfo.itemLevel
  };
}

function normalizeAion2Character(source, pcDataMap) {
  if (!source || typeof source !== "object") {
    return null;
  }

  const name = stripHtml(toStringValue(source.name));
  if (!name) {
    return null;
  }

  const serverId = toStringValue(source.serverId);
  const serverName = toStringValue(source.serverName);
  const characterId = safeDecodeURIComponent(toStringValue(source.characterId));
  const pcId = toStringValue(source.pcId);
  const classInfo = pcDataMap.get(pcId);
  const keyParts = ["aion2", serverId || serverName || "all", characterId || name];

  return {
    characterId,
    className: classInfo?.className || "미확인",
    combatPower: null,
    id: keyParts.filter(Boolean).join(":"),
    itemLevel: null,
    name,
    product: "aion2",
    serverId,
    serverName,
    worldName: ""
  };
}

function stripInternalFields(character) {
  return {
    className: character.className,
    combatPower: character.combatPower,
    id: character.id,
    itemLevel: character.itemLevel,
    name: character.name,
    product: character.product,
    serverId: character.serverId,
    serverName: character.serverName,
    worldName: character.worldName
  };
}

function sortCharacters(characters, keyword, serverId) {
  const normalizedKeyword = normalizeToken(keyword);

  return characters
    .slice()
    .sort((left, right) => {
      const leftScore = getMatchScore(left, normalizedKeyword, serverId);
      const rightScore = getMatchScore(right, normalizedKeyword, serverId);

      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }

      return left.name.localeCompare(right.name, "ko");
    });
}

function getMatchScore(character, normalizedKeyword, serverId) {
  const normalizedName = normalizeToken(character.name);
  let score = 0;

  if (normalizedName === normalizedKeyword) {
    score += 100;
  } else if (normalizedName.startsWith(normalizedKeyword)) {
    score += 50;
  } else if (normalizedName.includes(normalizedKeyword)) {
    score += 20;
  }

  if (serverId && character.serverId === serverId) {
    score += 10;
  }

  return score;
}

function dedupeCharacters(characters) {
  const map = new Map();

  characters.forEach((character) => {
    map.set(character.id, character);
  });

  return Array.from(map.values());
}

async function getCachedServers() {
  return getCachedValue(cache.servers, async () => {
    const payload = await requestAion2Json({
      path: AION2_SERVERS_PATH,
      query: { lang: "ko" }
    });

    return Array.isArray(payload.serverList)
      ? payload.serverList.map((item) => ({
          raceId: toStringValue(item.raceId),
          serverId: toStringValue(item.serverId),
          serverName: toStringValue(item.serverName),
          serverShortName: toStringValue(item.serverShortName)
        }))
      : [];
  });
}

async function getCachedPcDataMap() {
  return getCachedValue(cache.pcDataMap, async () => {
    const payload = await requestAion2Json({
      path: AION2_PCDATA_PATH,
      query: { lang: "ko" }
    });

    const map = new Map();
    const list = Array.isArray(payload.pcDataList) ? payload.pcDataList : [];

    list.forEach((item) => {
      const pcId = toStringValue(item.id);
      if (!pcId) {
        return;
      }

      map.set(pcId, {
        classKey: toStringValue(item.className),
        className: toStringValue(item.classText)
      });
    });

    return map;
  });
}

async function getCachedValue(target, loader) {
  if (target.value && Date.now() < target.expiresAt) {
    return target.value;
  }

  const value = await loader();
  target.value = value;
  target.expiresAt = Date.now() + CACHE_TTL_MS;
  return value;
}

async function getCharacterInfo({ characterId, characterInfoCache, serverId }) {
  const key = [serverId, characterId].join(":");

  if (!characterInfoCache.has(key)) {
    characterInfoCache.set(
      key,
      requestAion2Json({
        path: AION2_CHARACTER_INFO_PATH,
        query: {
          lang: "ko",
          characterId,
          serverId
        }
      })
        .then((payload) => {
          const profile = payload?.profile && typeof payload.profile === "object" ? payload.profile : {};
          const statList = Array.isArray(payload?.stat?.statList) ? payload.stat.statList : [];
          const itemLevelStat = statList.find((item) => toStringValue(item?.type) === "ItemLevel");

          return {
            className: toStringValue(profile.className),
            combatPower: toNumberValue(profile.combatPower),
            itemLevel: toNumberValue(profile.itemLevel ?? itemLevelStat?.value)
          };
        })
        .catch((error) => {
          if (error.statusCode === 404) {
            return null;
          }

          throw error;
        })
    );
  }

  return characterInfoCache.get(key);
}

function resolveServer(input, servers) {
  const trimmed = toStringValue(input);
  if (!trimmed) {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    const directMatch = servers.find((server) => server.serverId === trimmed);
    return directMatch || { serverId: trimmed, serverName: "", serverShortName: "" };
  }

  const token = normalizeToken(trimmed);
  const exactMatches = servers.filter((server) => {
    return [server.serverName, server.serverShortName]
      .filter(Boolean)
      .some((value) => normalizeToken(value) === token);
  });

  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  if (exactMatches.length > 1) {
    throw createError(
      400,
      `서버명 '${trimmed}' 이(가) 여러 서버와 일치합니다. 전체 서버명 또는 서버 ID를 입력해 주세요.`,
      {
        matches: exactMatches.map((item) => item.serverName)
      }
    );
  }

  const partialMatches = servers.filter((server) => {
    return [server.serverName, server.serverShortName]
      .filter(Boolean)
      .some((value) => normalizeToken(value).includes(token));
  });

  if (partialMatches.length === 1) {
    return partialMatches[0];
  }

  if (partialMatches.length > 1) {
    throw createError(
      400,
      `서버명 '${trimmed}' 이(가) 여러 서버와 일치합니다. 전체 서버명 또는 서버 ID를 입력해 주세요.`,
      {
        matches: partialMatches.map((item) => item.serverName)
      }
    );
  }

  throw createError(400, `AION2 서버 '${trimmed}' 을(를) 찾지 못했습니다.`);
}

async function requestAion2Json({ path, query }) {
  const url = new URL(path, AION2_BASE_URL);
  Object.entries(cleanObject(query)).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json"
    }
  });

  const rawText = await response.text();
  let data = null;

  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch (error) {
      data = { rawText };
    }
  }

  if (!response.ok) {
    throw createError(
      response.status,
      data?.error || data?.message || "AION2 API 호출에 실패했습니다.",
      {
        response: data,
        url: url.toString()
      }
    );
  }

  return data || {};
}

function cleanObject(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

function normalizeToken(value) {
  return toStringValue(value).replace(/\s+/g, "").toLowerCase();
}

function safeDecodeURIComponent(value) {
  const text = toStringValue(value);
  if (!text) {
    return "";
  }

  try {
    return decodeURIComponent(text);
  } catch (error) {
    return text;
  }
}

function stripHtml(value) {
  return toStringValue(value).replace(/<[^>]+>/g, "").trim();
}

function toStringValue(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function toNumberValue(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numeric = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function createError(statusCode, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details || null;
  return error;
}

function createHeaders() {
  return {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8"
  };
}

function jsonResponse(statusCode, body, headers) {
  return {
    statusCode,
    headers,
    body: JSON.stringify(body)
  };
}
