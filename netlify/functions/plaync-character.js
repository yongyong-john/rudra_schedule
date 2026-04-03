"use strict";

const API_BASE_URL = process.env.PLAYNC_API_BASE_URL || "https://dev-api.plaync.com";
const PLAYNC_API_KEY = process.env.PLAYNC_API_KEY;
const SUPPORTED_PRODUCTS = new Set(["aion2", "tl", "hoyeon", "lineagew", "bns2", "l2m"]);

const DEFAULT_SEARCH_PATHS = [
  "/characters/search",
  "/character/search",
  "/search/characters",
  "/characters"
];

const DEFAULT_DETAIL_PATHS = [
  "/characters/basic",
  "/characters/info",
  "/characters/power",
  "/characters/combat-power",
  "/characters/combat_power"
];

exports.handler = async function handler(event) {
  const headers = createHeaders();

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (!PLAYNC_API_KEY) {
    return jsonResponse(
      500,
      {
        error: "Netlify 환경 변수 PLAYNC_API_KEY가 설정되지 않았습니다."
      },
      headers
    );
  }

  const params = new URLSearchParams(event.queryStringParameters || {});
  const action = (params.get("action") || "search").trim();
  const product = (params.get("product") || "aion2").trim().toLowerCase();
  const keyword = (params.get("keyword") || "").trim();
  const server = (params.get("server") || "").trim();

  if (!SUPPORTED_PRODUCTS.has(product)) {
    return jsonResponse(400, { error: "지원하지 않는 게임 코드입니다." }, headers);
  }

  if (action !== "search") {
    return jsonResponse(400, { error: "지원하지 않는 action 입니다." }, headers);
  }

  if (!keyword) {
    return jsonResponse(400, { error: "keyword 파라미터가 필요합니다." }, headers);
  }

  try {
    const result = await searchCharacters({
      keyword,
      product,
      server
    });

    return jsonResponse(200, result, headers);
  } catch (error) {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    return jsonResponse(
      statusCode,
      {
        error: error.message || "PLAYNC API 호출에 실패했습니다.",
        details: error.details || null
      },
      headers
    );
  }
};

async function searchCharacters({ keyword, product, server }) {
  const searchPaths = readEnvList("PLAYNC_SEARCH_PATHS", DEFAULT_SEARCH_PATHS);
  const detailPaths = readEnvList("PLAYNC_DETAIL_PATHS", DEFAULT_DETAIL_PATHS);
  const searchQueries = buildSearchQueries(keyword, server);
  const tried = [];
  let lastNonFatalError = null;

  for (const path of searchPaths) {
    for (const query of searchQueries) {
      const attempt = await requestPlaync({
        path,
        product,
        query
      });

      tried.push({
        path,
        query
      });

      if (attempt.response.status === 404 || attempt.response.status === 400) {
        lastNonFatalError = attempt.data;
        continue;
      }

      if (!attempt.response.ok) {
        throw buildHttpError(attempt, tried);
      }

      const rawCharacters = findCandidateArray(attempt.data);
      const normalizedCharacters = rawCharacters
        .map((item) => normalizeCharacter(item, product))
        .filter(Boolean);

      if (!normalizedCharacters.length) {
        lastNonFatalError = attempt.data;
        continue;
      }

      const enrichedCharacters = await enrichCharacters({
        characters: normalizedCharacters,
        detailPaths,
        product,
        server
      });

      return {
        characters: stripInternalFields(enrichedCharacters),
        meta: {
          count: enrichedCharacters.length,
          searchPath: path,
          triedCount: tried.length
        }
      };
    }
  }

  const error = new Error(
    "검색 가능한 공식 엔드포인트를 찾지 못했습니다. PLAYNC_SEARCH_PATHS 또는 PLAYNC_DETAIL_PATHS 환경 변수를 확인해 주세요."
  );
  error.statusCode = 502;
  error.details = {
    lastResponse: lastNonFatalError,
    tried
  };
  throw error;
}

async function enrichCharacters({ characters, detailPaths, product, server }) {
  const limitedCharacters = characters.slice(0, 12);

  const resolved = await Promise.all(
    limitedCharacters.map(async (character) => {
      if (character.className !== "미확인" && character.combatPower !== null) {
        return character;
      }

      for (const path of detailPaths) {
        const queries = buildDetailQueries(character, server);
        for (const query of queries) {
          const attempt = await requestPlaync({
            path,
            product,
            query
          });

          if (attempt.response.status === 404 || attempt.response.status === 400) {
            continue;
          }

          if (!attempt.response.ok) {
            continue;
          }

          const detailObject = findCandidateObject(attempt.data);
          if (!detailObject) {
            continue;
          }

          const merged = mergeCharacter(
            character,
            normalizeCharacter(detailObject, product)
          );

          if (merged.className !== "미확인" || merged.combatPower !== null) {
            return merged;
          }
        }
      }

      return character;
    })
  );

  return resolved.concat(characters.slice(limitedCharacters.length));
}

function mergeCharacter(base, candidate) {
  if (!candidate) {
    return base;
  }

  return {
    ...base,
    ...candidate,
    id: base.id,
    name: candidate.name || base.name,
    product: base.product
  };
}

function buildSearchQueries(keyword, server) {
  const numericServer = /^\d+$/.test(server) ? server : "";
  const textServer = server && !numericServer ? server : "";

  return uniqueQueries([
    {
      character_name: keyword,
      server_id: numericServer,
      server_name: textServer
    },
    {
      characterName: keyword,
      serverId: numericServer,
      serverName: textServer
    },
    {
      name: keyword,
      server_id: numericServer,
      server_name: textServer
    },
    {
      search_keyword: keyword,
      server_id: numericServer,
      server_name: textServer
    },
    {
      keyword,
      server_id: numericServer,
      server_name: textServer
    },
    {
      q: keyword,
      server_id: numericServer,
      server_name: textServer
    }
  ]);
}

function buildDetailQueries(character, server) {
  const numericServer = /^\d+$/.test(server) ? server : "";
  const name = character.name;
  const characterId = character.characterId || "";
  const serverId = character.serverId || numericServer;
  const serverName = character.serverName || server;

  return uniqueQueries([
    {
      character_name: name,
      character_id: characterId,
      server_id: serverId,
      server_name: serverName
    },
    {
      characterName: name,
      characterId,
      serverId,
      serverName
    },
    {
      name,
      id: characterId,
      server_id: serverId,
      server_name: serverName
    }
  ]);
}

async function requestPlaync({ path, product, query }) {
  const url = new URL(`${API_BASE_URL.replace(/\/+$/, "")}/${product}/v1.0${path}`);
  Object.entries(cleanObject(query)).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${PLAYNC_API_KEY}`
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

  return {
    data,
    response,
    url: url.toString()
  };
}

function normalizeCharacter(source, product) {
  if (!source || typeof source !== "object") {
    return null;
  }

  const name = toStringValue(
    pickDeepValue(source, [
      "character_name",
      "characterName",
      "name",
      "character",
      "nickname",
      "nick_name"
    ])
  );

  if (!name) {
    return null;
  }

  const serverId = toStringValue(
    pickDeepValue(source, ["server_id", "serverId", "world_id", "worldId"])
  );
  const serverName = toStringValue(
    pickDeepValue(source, ["server_name", "serverName"])
  );
  const worldName = toStringValue(
    pickDeepValue(source, ["world_name", "worldName"])
  );
  const className = toStringValue(
    pickDeepValue(source, [
      "class_name",
      "className",
      "class",
      "job_name",
      "jobName",
      "character_class"
    ])
  );
  const characterId = toStringValue(
    pickDeepValue(source, ["character_id", "characterId", "id"])
  );
  const combatPower = toNumberValue(
    pickDeepValue(source, [
      "combat_power",
      "combatPower",
      "battle_power",
      "battlePower",
      "power",
      "cp",
      "total_power"
    ])
  );

  const keyParts = [
    product,
    serverId || serverName || worldName || "all",
    characterId || name
  ].filter(Boolean);

  return {
    characterId,
    className: className || "미확인",
    combatPower,
    id: keyParts.join(":"),
    name,
    product,
    serverId,
    serverName,
    worldName
  };
}

function findCandidateArray(payload) {
  if (!payload) {
    return [];
  }

  if (Array.isArray(payload)) {
    return payload;
  }

  if (looksLikeCharacterRecord(payload)) {
    return [payload];
  }

  const preferredKeys = ["contents", "characters", "results", "items", "list", "data", "rows"];
  for (const key of preferredKeys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value;
    }

    if (value && typeof value === "object") {
      for (const nestedKey of preferredKeys) {
        if (Array.isArray(value[nestedKey])) {
          return value[nestedKey];
        }
      }
    }
  }

  const queue = [payload];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) {
      continue;
    }

    seen.add(current);

    if (Array.isArray(current)) {
      if (current.some((item) => item && typeof item === "object")) {
        return current;
      }
      continue;
    }

    Object.values(current).forEach((value) => {
      if (value && typeof value === "object") {
        queue.push(value);
      }
    });
  }

  return [];
}

function findCandidateObject(payload) {
  if (!payload) {
    return null;
  }

  if (Array.isArray(payload)) {
    return payload.find((item) => item && typeof item === "object") || null;
  }

  if (payload && typeof payload === "object") {
    if (looksLikeCharacterRecord(payload)) {
      return payload;
    }

    const queue = [payload];
    const seen = new Set();
    while (queue.length) {
      const current = queue.shift();
      if (!current || typeof current !== "object" || seen.has(current)) {
        continue;
      }

      seen.add(current);
      if (looksLikeCharacterRecord(current)) {
        return current;
      }

      Object.values(current).forEach((value) => {
        if (value && typeof value === "object") {
          queue.push(value);
        }
      });
    }
  }

  return null;
}

function pickDeepValue(source, keys) {
  const queue = [source];
  const seen = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) {
      continue;
    }

    seen.add(current);

    for (const key of keys) {
      if (current[key] !== undefined && current[key] !== null && current[key] !== "") {
        return current[key];
      }
    }

    Object.values(current).forEach((value) => {
      if (value && typeof value === "object") {
        queue.push(value);
      }
    });
  }

  return null;
}

function stripInternalFields(characters) {
  return characters.map((character) => ({
    className: character.className,
    combatPower: character.combatPower,
    id: character.id,
    name: character.name,
    product: character.product,
    serverId: character.serverId,
    serverName: character.serverName,
    worldName: character.worldName
  }));
}

function buildHttpError(attempt, tried) {
  const message =
    attempt.data?.detail
    || attempt.data?.error
    || attempt.data?.message
    || "PLAYNC API 호출에 실패했습니다.";

  const error = new Error(message);
  error.statusCode = attempt.response.status === 401 ? 502 : attempt.response.status;
  error.details = {
    status: attempt.response.status,
    tried,
    url: attempt.url
  };
  return error;
}

function readEnvList(key, fallback) {
  const raw = process.env[key];
  if (!raw) {
    return fallback;
  }

  const parsed = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return parsed.length ? parsed : fallback;
}

function uniqueQueries(queries) {
  const seen = new Set();

  return queries
    .map(cleanObject)
    .filter((query) => Object.keys(query).length)
    .filter((query) => {
      const signature = JSON.stringify(query);
      if (seen.has(signature)) {
        return false;
      }

      seen.add(signature);
      return true;
    });
}

function cleanObject(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
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

function looksLikeCharacterRecord(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return false;
  }

  return [
    "character_name",
    "characterName",
    "name",
    "class_name",
    "className",
    "combat_power",
    "combatPower",
    "battle_power",
    "battlePower"
  ].some((key) => candidate[key] !== undefined && candidate[key] !== null && candidate[key] !== "");
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
