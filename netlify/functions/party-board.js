"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { connectLambda, getStore } = require("@netlify/blobs");

const BOARD_CODE_LENGTH = 8;
const BOARD_CODE_PATTERN = /^[A-Za-z0-9]{8}$/;
const BOARD_STORE_NAME = "aion2-party-boards";
const MAX_CREATE_ATTEMPTS = 24;
const SUPPORTED_PRODUCTS = new Set(["aion2"]);
const BOARD_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const EMPTY_BOARD_TTL_MS = 60 * 60 * 1000;
const INACTIVE_BOARD_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const ACTIVITY_TOUCH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CLEANUP_RUN_INTERVAL_MS = 30 * 60 * 1000;
const CLEANUP_META_KEY = "_meta/cleanup";
const LOCAL_STORE_PATH = path.join(process.cwd(), ".data", "party-board-store.json");

exports.handler = async function handler(event) {
  const headers = createHeaders();

  if (event?.blobs && !process.env.NETLIFY_BLOBS_CONTEXT && !globalThis.netlifyBlobsContext) {
    connectLambda(event);
  }

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const params = new URLSearchParams(event.queryStringParameters || {});
  const action = (params.get("action") || "").trim().toLowerCase();

  try {
    if (event.httpMethod === "GET" && action === "load") {
      const boardCode = normalizeBoardCode(params.get("boardCode"));
      const payload = await loadBoard(boardCode);
      return jsonResponse(200, payload, headers);
    }

    if (event.httpMethod === "POST" && action === "create") {
      const body = readJsonBody(event.body);
      const payload = await createBoard(body?.state);
      return jsonResponse(200, payload, headers);
    }

    if (event.httpMethod === "POST" && action === "save") {
      const body = readJsonBody(event.body);
      const boardCode = normalizeBoardCode(body?.boardCode);
      const payload = await saveBoard(boardCode, body?.state);
      return jsonResponse(200, payload, headers);
    }

    return jsonResponse(400, { error: "지원하지 않는 요청입니다." }, headers);
  } catch (error) {
    return jsonResponse(
      Number.isInteger(error.statusCode) ? error.statusCode : 500,
      {
        error: error.message || "보드 저장소 요청에 실패했습니다."
      },
      headers
    );
  }
};

exports.config = {
  path: "/.netlify/functions/party-board",
  rateLimit: {
    windowLimit: 30,
    windowSize: 60,
    aggregateBy: ["ip", "domain"]
  }
};

async function createBoard(inputState) {
  await maybeCleanupExpiredBoards();
  const state = sanitizeBoardState(inputState);

  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
    const boardCode = generateBoardCode();
    const now = new Date().toISOString();
    const entry = createBoardEntry(boardCode, state, now);

    const result = await storeSetJson(boardCode, entry, {
      onlyIfNew: true
    });

    if (result?.modified) {
      return toPublicBoardPayload(entry);
    }
  }

  throw createError(500, "새 서버 보드 코드를 생성하지 못했습니다.");
}

async function loadBoard(boardCode) {
  const entry = await getBoardEntry(boardCode, { touchActivity: true });
  return toPublicBoardPayload(entry);
}

async function saveBoard(boardCode, inputState) {
  await maybeCleanupExpiredBoards();
  const existing = await getBoardEntry(boardCode, { touchActivity: false });
  const nextState = sanitizeBoardState(inputState);
  const updatedAt = new Date().toISOString();
  const existingIsEmpty = isBoardStateEmpty(existing.state);
  const nextIsEmpty = isBoardStateEmpty(nextState);

  const entry = {
    boardCode,
    createdAt: existing.createdAt || updatedAt,
    updatedAt,
    lastActivityAt: updatedAt,
    emptySinceAt: nextIsEmpty
      ? (existingIsEmpty ? existing.emptySinceAt || updatedAt : updatedAt)
      : "",
    state: nextState
  };

  await storeSetJson(boardCode, entry);

  return toPublicBoardPayload(entry);
}

async function getBoardEntry(boardCode, options = {}) {
  const rawEntry = await storeGetJson(boardCode);
  const entry = normalizeBoardEntry(boardCode, rawEntry);

  if (!entry) {
    throw createError(404, "해당 서버 보드를 찾지 못했습니다.");
  }

  const expiration = getBoardExpiration(entry);
  if (expiration.expired) {
    await storeDelete(boardCode);
    throw createError(404, expiration.message);
  }

  if (options.touchActivity !== false && shouldTouchBoardActivity(entry)) {
    const now = new Date().toISOString();
    entry.lastActivityAt = now;
    await storeSetJson(boardCode, entry);
  }

  return entry;
}

function createBoardEntry(boardCode, state, now) {
  return {
    boardCode,
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    emptySinceAt: isBoardStateEmpty(state) ? now : "",
    state
  };
}

function toPublicBoardPayload(entry) {
  return {
    boardCode: entry.boardCode,
    createdAt: toStringValue(entry.createdAt) || null,
    updatedAt: toStringValue(entry.updatedAt) || null,
    state: sanitizeBoardState(entry.state)
  };
}

function normalizeBoardEntry(boardCode, entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const state = sanitizeBoardState(entry.state);
  const createdAt = toStringValue(entry.createdAt) || toStringValue(entry.updatedAt);
  const updatedAt = toStringValue(entry.updatedAt) || createdAt;
  const lastActivityAt = toStringValue(entry.lastActivityAt) || updatedAt || createdAt;
  const isEmpty = isBoardStateEmpty(state);

  return {
    boardCode,
    createdAt,
    updatedAt,
    lastActivityAt,
    emptySinceAt: isEmpty
      ? (toStringValue(entry.emptySinceAt) || updatedAt || createdAt || lastActivityAt)
      : "",
    state
  };
}

function isBoardStateEmpty(state) {
  const groups = Array.isArray(state?.groups) ? state.groups : [];
  const stash = Array.isArray(state?.stash) ? state.stash : [];

  const hasAssignedCharacters = groups.some((group) => (
    Array.isArray(group?.parties)
      && group.parties.some((party) => Array.isArray(party) && party.length > 0)
  ));

  return !hasAssignedCharacters && stash.length === 0;
}

function getBoardExpiration(entry, now = Date.now()) {
  const emptySinceAt = parseTimestamp(entry.emptySinceAt);
  if (entry.emptySinceAt && Number.isFinite(emptySinceAt) && now - emptySinceAt >= EMPTY_BOARD_TTL_MS) {
    return {
      expired: true,
      message: "공유 보드가 만료되어 삭제되었습니다. 그룹 편성과 보관함이 1시간 이상 비어 있었습니다."
    };
  }

  const lastActivityAt = parseTimestamp(entry.lastActivityAt)
    || parseTimestamp(entry.updatedAt)
    || parseTimestamp(entry.createdAt);

  if (Number.isFinite(lastActivityAt) && now - lastActivityAt >= INACTIVE_BOARD_TTL_MS) {
    return {
      expired: true,
      message: "공유 보드가 만료되어 삭제되었습니다. 2주 이상 접속이나 편집이 없었습니다."
    };
  }

  return {
    expired: false,
    message: ""
  };
}

function shouldTouchBoardActivity(entry, now = Date.now()) {
  const lastActivityAt = parseTimestamp(entry.lastActivityAt)
    || parseTimestamp(entry.updatedAt)
    || parseTimestamp(entry.createdAt);

  if (!Number.isFinite(lastActivityAt)) {
    return true;
  }

  return now - lastActivityAt >= ACTIVITY_TOUCH_INTERVAL_MS;
}

async function maybeCleanupExpiredBoards() {
  const cleanupMeta = await storeGetJson(CLEANUP_META_KEY);
  const lastRunAt = parseTimestamp(cleanupMeta?.lastRunAt);
  const now = Date.now();

  if (Number.isFinite(lastRunAt) && now - lastRunAt < CLEANUP_RUN_INTERVAL_MS) {
    return;
  }

  const keys = await storeListKeys();
  let deletedCount = 0;

  for (const key of keys) {
    if (!BOARD_CODE_PATTERN.test(key)) {
      continue;
    }

    const entry = normalizeBoardEntry(key, await storeGetJson(key));
    if (!entry) {
      continue;
    }

    if (getBoardExpiration(entry, now).expired) {
      await storeDelete(key);
      deletedCount += 1;
    }
  }

  await storeSetJson(CLEANUP_META_KEY, {
    lastRunAt: new Date(now).toISOString(),
    deletedCount
  });
}

function sanitizeBoardState(inputState) {
  const state = inputState && typeof inputState === "object" ? inputState : {};
  const groups = Array.isArray(state.groups) && state.groups.length
    ? state.groups.map(normalizeGroup).filter(Boolean)
    : [createGroup(1)];

  return {
    nextGroupId: Number.isInteger(state.nextGroupId) ? state.nextGroupId : groups.length + 1,
    groups,
    results: Array.isArray(state.results) ? state.results.map(normalizeCharacter).filter(Boolean) : [],
    stash: Array.isArray(state.stash) ? state.stash.map(normalizeCharacter).filter(Boolean) : [],
    settings: {
      keyword: toStringValue(state.settings?.keyword),
      product: SUPPORTED_PRODUCTS.has(toStringValue(state.settings?.product).toLowerCase())
        ? toStringValue(state.settings.product).toLowerCase()
        : "aion2",
      server: toStringValue(state.settings?.server),
      sortBy: toStringValue(state.settings?.sortBy) === "itemLevel" ? "itemLevel" : "combatPower"
    },
    ui: {
      searchMeta: state.ui?.searchMeta ?? null
    }
  };
}

function normalizeGroup(group) {
  if (!group || !Array.isArray(group.parties)) {
    return null;
  }

  const parties = group.parties.slice(0, 2).map((party) => {
    if (!Array.isArray(party)) {
      return [];
    }

    return party.slice(0, 4).map(normalizeCharacter).filter(Boolean);
  });

  while (parties.length < 2) {
    parties.push([]);
  }

  return {
    id: Number.isInteger(group.id) ? group.id : Date.now(),
    parties
  };
}

function normalizeCharacter(character) {
  if (!character || typeof character !== "object") {
    return null;
  }

  const name = toStringValue(character.name);
  if (!name) {
    return null;
  }

  const product = SUPPORTED_PRODUCTS.has(toStringValue(character.product).toLowerCase())
    ? toStringValue(character.product).toLowerCase()
    : "aion2";

  const serverKey = [character.serverId, character.serverName, character.worldName]
    .map((value) => toStringValue(value))
    .find(Boolean);

  return {
    id: toStringValue(character.id) || [product, serverKey || "all", name].join(":"),
    product,
    name,
    className: toStringValue(character.className) || "미확인",
    classIconUrl: toStringValue(character.classIconUrl),
    combatPower: normalizePower(character.combatPower),
    itemLevel: normalizePower(character.itemLevel),
    serverId: toStringValue(character.serverId),
    serverName: toStringValue(character.serverName),
    worldName: toStringValue(character.worldName)
  };
}

function normalizePower(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function createGroup(id) {
  return {
    id,
    parties: [[], []]
  };
}

function normalizeBoardCode(value) {
  const boardCode = toStringValue(value);

  if (!BOARD_CODE_PATTERN.test(boardCode)) {
    throw createError(400, "8자리 영문 대소문자와 숫자로 된 보드 코드를 입력해 주세요.");
  }

  return boardCode;
}

function generateBoardCode() {
  let boardCode = "";

  for (let index = 0; index < BOARD_CODE_LENGTH; index += 1) {
    const randomIndex = Math.floor(Math.random() * BOARD_CODE_ALPHABET.length);
    boardCode += BOARD_CODE_ALPHABET[randomIndex];
  }

  return boardCode;
}

function readJsonBody(body) {
  if (!body) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    throw createError(400, "JSON 본문을 해석하지 못했습니다.");
  }
}

function createHeaders() {
  return {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  };
}

function jsonResponse(statusCode, payload, headers) {
  return {
    statusCode,
    headers,
    body: JSON.stringify(payload)
  };
}

async function storeGetJson(key) {
  try {
    const store = getBlobStore();

    try {
      return await store.get(key, {
        consistency: "strong",
        type: "json"
      });
    } catch (error) {
      if (!String(error?.message || "").includes("uncachedEdgeURL")) {
        throw error;
      }

      return await store.get(key, { type: "json" });
    }
  } catch (error) {
    if (!isLocalFallbackCandidate(error)) {
      throw error;
    }

    const store = await readLocalStore();
    return store[key] || null;
  }
}

async function storeSetJson(key, value, options = {}) {
  try {
    return await getBlobStore().setJSON(key, value, options);
  } catch (error) {
    if (!isLocalFallbackCandidate(error)) {
      throw error;
    }

    const store = await readLocalStore();

    if (options.onlyIfNew && store[key]) {
      return { modified: false };
    }

    store[key] = value;
    await writeLocalStore(store);
    return {
      etag: new Date().toISOString(),
      modified: true
    };
  }
}

async function storeDelete(key) {
  try {
    await getBlobStore().delete(key);
  } catch (error) {
    if (!isLocalFallbackCandidate(error)) {
      throw error;
    }

    const store = await readLocalStore();
    delete store[key];
    await writeLocalStore(store);
  }
}

async function storeListKeys() {
  try {
    const result = await getBlobStore().list();
    return Array.isArray(result?.blobs)
      ? result.blobs.map((blob) => blob?.key).filter(Boolean)
      : [];
  } catch (error) {
    if (!isLocalFallbackCandidate(error)) {
      throw error;
    }

    const store = await readLocalStore();
    return Object.keys(store);
  }
}

function getBlobStore() {
  return getStore(BOARD_STORE_NAME);
}

function isLocalFallbackCandidate(error) {
  const message = String(error?.message || "");
  return message.includes("MissingBlobsEnvironmentError")
    || message.includes("not been configured to use Netlify Blobs");
}

async function readLocalStore() {
  try {
    const raw = await fs.readFile(LOCAL_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

async function writeLocalStore(value) {
  await fs.mkdir(path.dirname(LOCAL_STORE_PATH), { recursive: true });
  await fs.writeFile(LOCAL_STORE_PATH, JSON.stringify(value, null, 2), "utf8");
}

function toStringValue(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function parseTimestamp(value) {
  const normalized = toStringValue(value);
  if (!normalized) {
    return Number.NaN;
  }

  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function createError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
