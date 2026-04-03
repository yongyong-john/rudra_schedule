const LOCAL_STORAGE_KEY = "plaync-party-builder:local:v2";
const BOARD_CODE_PARAM = "board";
const SERVER_POLL_INTERVAL_MS = 2000;
const SERVER_SAVE_DEBOUNCE_MS = 500;

const PRODUCT_OPTIONS = [
  { value: "aion2", label: "AION2" }
];

const elements = {
  addGroupBtn: document.getElementById("addGroupBtn"),
  assignmentSummary: document.getElementById("assignmentSummary"),
  boardCodeBlock: document.getElementById("boardCodeBlock"),
  boardCodeValue: document.getElementById("boardCodeValue"),
  clearResultsBtn: document.getElementById("clearResultsBtn"),
  groupsContainer: document.getElementById("groupsContainer"),
  keywordInput: document.getElementById("keywordInput"),
  productSelect: document.getElementById("productSelect"),
  resultsCount: document.getElementById("resultsCount"),
  resultsList: document.getElementById("resultsList"),
  resultsReleaseZone: document.getElementById("resultsReleaseZone"),
  searchButton: document.getElementById("searchButton"),
  searchForm: document.getElementById("searchForm"),
  searchHint: document.getElementById("searchHint"),
  searchStatus: document.getElementById("searchStatus"),
  serverInput: document.getElementById("serverInput"),
  shareBoardBtn: document.getElementById("shareBoardBtn"),
  shareStatusText: document.getElementById("shareStatusText"),
  stashContainer: document.getElementById("stashContainer"),
  stashCount: document.getElementById("stashCount"),
  sortSelect: document.getElementById("sortSelect"),
  toast: document.getElementById("toast")
};

let state = createDefaultState();
const session = createSessionState();
let toastTimer = null;

bindEvents();
initializeApp();

function createDefaultState() {
  return {
    nextGroupId: 2,
    groups: [createGroup(1)],
    results: [],
    stash: [],
    settings: {
      keyword: "",
      product: "aion2",
      server: "",
      sortBy: "combatPower"
    },
    ui: {
      searchMeta: null,
      searchLoading: false
    }
  };
}

function createSessionState() {
  return {
    boardCode: "",
    isApplyingRemote: false,
    isSaving: false,
    lastServerUpdatedAt: "",
    mode: "local",
    saveTimer: null,
    statusMessage: "",
    syncTimer: null
  };
}

async function initializeApp() {
  const sharedBoardCode = readBoardCodeFromLocation();

  if (sharedBoardCode) {
    try {
      await activateServerBoard(sharedBoardCode, { fromSharedLink: true });
      return;
    } catch (error) {
      clearBoardCodeInLocation();
      activateLocalMode({ skipToast: true });
      showToast(error.message || "공유 링크 보드를 불러오지 못했습니다.", "error");
      return;
    }
  }

  activateLocalMode({ skipToast: true });
}

function hydrateLocalState() {
  const fallback = createDefaultState();

  try {
    const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!stored) {
      return fallback;
    }

    return normalizeStoredState(JSON.parse(stored), fallback);
  } catch (error) {
    return fallback;
  }
}

function normalizeStoredState(parsed, fallback) {
  const safeFallback = fallback || createDefaultState();
  const groups = Array.isArray(parsed?.groups) && parsed.groups.length
    ? parsed.groups.map(normalizeGroup).filter(Boolean)
    : safeFallback.groups;

  return {
    nextGroupId: Number.isInteger(parsed?.nextGroupId) ? parsed.nextGroupId : groups.length + 1,
    groups,
    results: Array.isArray(parsed?.results) ? parsed.results.map(normalizeCharacter).filter(Boolean) : [],
    stash: Array.isArray(parsed?.stash) ? parsed.stash.map(normalizeCharacter).filter(Boolean) : [],
    settings: {
      keyword: typeof parsed?.settings?.keyword === "string" ? parsed.settings.keyword : "",
      product: PRODUCT_OPTIONS.some((option) => option.value === parsed?.settings?.product)
        ? parsed.settings.product
        : "aion2",
      server: typeof parsed?.settings?.server === "string" ? parsed.settings.server : "",
      sortBy: parsed?.settings?.sortBy === "itemLevel" ? "itemLevel" : "combatPower"
    },
    ui: {
      searchMeta: parsed?.ui?.searchMeta ?? null,
      searchLoading: false
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

  const name = typeof character.name === "string" ? character.name.trim() : "";
  if (!name) {
    return null;
  }

  const product = PRODUCT_OPTIONS.some((option) => option.value === character.product)
    ? character.product
    : "aion2";

  const serverKey = [character.serverId, character.serverName, character.worldName]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find(Boolean);

  return {
    id: typeof character.id === "string" && character.id.trim()
      ? character.id.trim()
      : [product, serverKey || "all", name].join(":"),
    product,
    name,
    className: typeof character.className === "string" && character.className.trim()
      ? character.className.trim()
      : "미확인",
    classIconUrl: typeof character.classIconUrl === "string" ? character.classIconUrl.trim() : "",
    combatPower: normalizePower(character.combatPower),
    itemLevel: normalizePower(character.itemLevel),
    serverId: typeof character.serverId === "string" ? character.serverId.trim() : "",
    serverName: typeof character.serverName === "string" ? character.serverName.trim() : "",
    worldName: typeof character.worldName === "string" ? character.worldName.trim() : ""
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

function syncForm() {
  elements.keywordInput.value = state.settings.keyword;
  elements.productSelect.value = state.settings.product;
  elements.serverInput.value = state.settings.server;
  elements.sortSelect.value = state.settings.sortBy;
}

function bindEvents() {
  elements.shareBoardBtn.addEventListener("click", handleShareBoard);
  window.addEventListener("popstate", () => {
    handleLocationChange().catch((error) => {
      activateLocalMode({ skipToast: true });
      showToast(error.message || "공유 보드 상태를 불러오지 못했습니다.", "error");
    });
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && session.mode === "server" && session.boardCode) {
      syncServerBoard({ silent: true }).catch(() => {});
    }
  });

  elements.addGroupBtn.addEventListener("click", () => {
    state.groups.push(createGroup(state.nextGroupId));
    state.nextGroupId += 1;
    persistState();
    render();
    showToast("새 그룹이 추가되었습니다.");
  });

  elements.clearResultsBtn.addEventListener("click", () => {
    state.results = [];
    state.ui.searchMeta = null;
    persistState();
    render();
    showToast("검색 결과를 비웠습니다.");
  });

  elements.searchForm.addEventListener("submit", handleSearchSubmit);
  elements.sortSelect.addEventListener("change", handleSortChange);

  elements.resultsReleaseZone.addEventListener("dragover", handleDragOver);
  elements.resultsReleaseZone.addEventListener("dragleave", handleDragLeave);
  elements.resultsReleaseZone.addEventListener("drop", handleDropToReleaseZone);
}

function activateLocalMode(options = {}) {
  const nextState = options.preserveState
    ? normalizeStoredState(exportBoardState(), createDefaultState())
    : hydrateLocalState();

  stopServerSync();
  session.mode = "local";
  session.boardCode = "";
  session.lastServerUpdatedAt = "";
  session.statusMessage = "기본 URL은 현재 브라우저에만 저장됩니다. 공유가 필요할 때 Url 공유를 누르세요.";
  state = nextState;

  if (options.preserveState) {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(exportBoardState(nextState)));
  }

  if (options.clearUrl) {
    clearBoardCodeInLocation({ replace: true });
  }

  render();

  if (!options.skipToast) {
    showToast(options.toastMessage || "기본 URL 로컬 보드를 불러왔습니다.");
  }
}

async function handleShareBoard() {
  if (session.mode === "server" && session.boardCode) {
    await handleCopyShareLink();
    return;
  }

  try {
    const response = await requestBoardApi("create", {
      method: "POST",
      body: {
        state: exportBoardState()
      }
    });

    stopServerSync();
    session.mode = "server";
    session.boardCode = response.boardCode;
    session.lastServerUpdatedAt = response.updatedAt || "";
    session.statusMessage = "공유 보드가 생성되었습니다. 같은 URL에서 함께 편집할 수 있습니다.";
    state = normalizeStoredState(response.state, createDefaultState());
    setBoardCodeInLocation(response.boardCode, { replace: false });
    startServerSync();
    render();
    const copied = await copyShareLinkToClipboard(response.boardCode);
    showToast(
      copied
        ? `공유 보드 ${response.boardCode}를 만들고 URL을 복사했습니다.`
        : `공유 보드 ${response.boardCode}를 만들었습니다.`,
      copied ? "info" : "warn"
    );
  } catch (error) {
    showToast(error.message || "공유 보드를 생성하지 못했습니다.", "error");
  }
}

async function activateServerBoard(boardCode, options = {}) {
  const response = await requestBoardApi("load", {
    method: "GET",
    boardCode
  });

  stopServerSync();
  session.mode = "server";
  session.boardCode = response.boardCode;
  session.lastServerUpdatedAt = response.updatedAt || "";
  session.statusMessage = options.fromSharedLink
    ? "공유 URL에 연결되었습니다. 변경 내용은 약 2초 간격으로 동기화됩니다."
    : "공유 보드를 불러왔습니다.";
  state = normalizeStoredState(response.state, createDefaultState());

  if (options.updateUrl !== false) {
    setBoardCodeInLocation(response.boardCode);
  }

  startServerSync();
  render();
}

async function handleCopyShareLink() {
  if (session.mode !== "server" || !session.boardCode) {
    return;
  }

  try {
    const copied = await copyShareLinkToClipboard(session.boardCode);
    if (copied) {
      showToast("공유 URL을 복사했습니다.");
      return;
    }

    const shareLink = getShareLink(session.boardCode);
    showToast(`공유 URL을 복사하지 못했습니다. ${shareLink}`, "warn");
  } catch (error) {
    const shareLink = getShareLink(session.boardCode);
    showToast(`공유 URL을 복사하지 못했습니다. ${shareLink}`, "warn");
  }
}

function handleUnavailableSharedBoard(error) {
  const boardCode = session.boardCode;

  activateLocalMode({
    clearUrl: true,
    preserveState: true,
    skipToast: true
  });

  showToast(
    error.message || `공유 보드 ${boardCode}를 찾지 못해 기본 URL 로컬 보드로 전환했습니다.`,
    "warn"
  );
}

async function handleLocationChange() {
  const boardCode = readBoardCodeFromLocation();

  if (!boardCode) {
    if (session.mode === "server") {
      activateLocalMode({ skipToast: true });
    }
    return;
  }

  if (session.mode === "server" && session.boardCode === boardCode) {
    return;
  }

  try {
    await activateServerBoard(boardCode, {
      fromSharedLink: true,
      updateUrl: false
    });
  } catch (error) {
    clearBoardCodeInLocation();
    activateLocalMode({ skipToast: true });
    throw error;
  }
}

async function copyShareLinkToClipboard(boardCode) {
  const shareLink = getShareLink(boardCode);

  try {
    await navigator.clipboard.writeText(shareLink);
    return true;
  } catch (error) {
    return false;
  }
}

function handleSortChange(event) {
  state.settings.sortBy = event.target.value === "itemLevel" ? "itemLevel" : "combatPower";
  state.results = sortResultCharacters(state.results);
  persistState();
  render();
}

async function handleSearchSubmit(event) {
  event.preventDefault();

  const keyword = elements.keywordInput.value.trim();
  const product = elements.productSelect.value;
  const server = elements.serverInput.value.trim();
  const sortBy = elements.sortSelect.value === "itemLevel" ? "itemLevel" : "combatPower";

  if (!keyword) {
    showToast("캐릭터명을 입력해 주세요.", "warn");
    elements.keywordInput.focus();
    return;
  }

  state.settings.keyword = keyword;
  state.settings.product = product;
  state.settings.server = server;
  state.settings.sortBy = sortBy;
  state.ui.searchLoading = true;
  state.ui.searchMeta = null;
  render();

  const params = new URLSearchParams({
    action: "search",
    keyword,
    product,
    sortBy
  });

  if (server) {
    params.set("server", server);
  }

  try {
    const response = await fetch(`/.netlify/functions/plaync-character?${params.toString()}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "캐릭터 검색에 실패했습니다.");
    }

    const characters = Array.isArray(payload.characters)
      ? payload.characters.map(normalizeCharacter).filter(Boolean)
      : [];

    state.results = mergeCharacters(state.results, characters, true);
    syncAssignedCardsWithResults(characters);
    syncStashedCardsWithResults(characters);
    state.ui.searchMeta = payload.meta ?? null;
    state.ui.searchLoading = false;
    persistState();
    render();

    const successMessage = characters.length
      ? `${characters.length}명의 캐릭터를 불러왔습니다.`
      : "검색 결과가 없습니다.";
    showToast(successMessage);
  } catch (error) {
    state.ui.searchLoading = false;
    render();
    showToast(error.message || "캐릭터 검색 중 오류가 발생했습니다.", "error");
  }
}

function render() {
  renderSharePanel();
  renderSummary();
  renderGroups();
  renderStash();
  renderResults();
  renderSearchStatus();
  syncForm();
}

function renderSharePanel() {
  const isServerMode = session.mode === "server";
  elements.boardCodeBlock.hidden = !isServerMode;
  elements.boardCodeValue.textContent = session.boardCode || "--------";
  elements.shareBoardBtn.textContent = isServerMode ? "공유 URL 복사" : "Url 공유";

  if (isServerMode) {
    const syncLabel = session.isSaving
      ? "서버에 저장 중입니다."
      : "같은 공유 URL로 접속한 사람들과 약 2초 간격으로 동기화됩니다.";
    elements.shareStatusText.textContent = session.statusMessage || syncLabel;
    return;
  }

  elements.shareStatusText.textContent = session.statusMessage
    || "기본 URL에서는 현재 브라우저에만 저장됩니다. 공유가 필요할 때 Url 공유를 누르세요.";
}

function renderSummary() {
  const assignedCount = flattenAssignedCharacters().length;
  const capacity = state.groups.length * 8;
  const visibleResults = getVisibleResultCharacters();
  elements.assignmentSummary.textContent = `${assignedCount} / ${capacity} 배치`;
  elements.resultsCount.textContent = `검색 결과 ${visibleResults.length}명`;
  elements.stashCount.textContent = `보관 ${state.stash.length}명`;
  elements.searchButton.disabled = state.ui.searchLoading;
  elements.searchButton.textContent = state.ui.searchLoading ? "검색 중..." : "검색";
}

function renderGroups() {
  elements.groupsContainer.innerHTML = "";

  state.groups.forEach((group, groupIndex) => {
    const groupCard = document.createElement("section");
    groupCard.className = "group-card";

    const assignedCount = group.parties[0].length + group.parties[1].length;
    const groupHead = document.createElement("div");
    groupHead.className = "group-head";

    const titleWrap = document.createElement("div");
    titleWrap.className = "group-title-wrap";
    titleWrap.innerHTML = `
      <h3>${groupIndex + 1}그룹</h3>
      <p>총 ${assignedCount}명 배치 · 최대 8명</p>
    `;

    const actions = document.createElement("div");
    actions.className = "group-actions";

    if (state.groups.length > 1) {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "btn btn-ghost";
      removeButton.textContent = "그룹 삭제";
      removeButton.addEventListener("click", () => removeGroup(group.id));
      actions.appendChild(removeButton);
    }

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "btn btn-ghost";
    clearButton.textContent = "그룹 초기화";
    clearButton.addEventListener("click", () => clearGroup(group.id));
    actions.appendChild(clearButton);

    groupHead.append(titleWrap, actions);

    const grid = document.createElement("div");
    grid.className = "group-grid";

    group.parties.forEach((party, partyIndex) => {
      const partyCard = document.createElement("article");
      partyCard.className = "party-card";

      const partyHead = document.createElement("div");
      partyHead.className = "party-head";
      partyHead.innerHTML = `
        <h4>${partyIndex + 1}파티</h4>
        <span>${party.length} / 4</span>
      `;

      const partyList = document.createElement("div");
      partyList.className = "party-list";

      if (!party.length) {
        partyList.appendChild(createEmptyDropZone(group.id, partyIndex));
      } else {
        party.forEach((character, index) => {
          partyList.appendChild(createPartyCharacterCard(character, group.id, partyIndex, index));
        });
        partyList.appendChild(createEndDropZone(group.id, partyIndex, party.length));
      }

      const placeholders = document.createElement("div");
      placeholders.className = "slot-placeholders";
      for (let slot = party.length; slot < 4; slot += 1) {
        const placeholder = document.createElement("div");
        placeholder.className = "slot-placeholder";
        placeholders.appendChild(placeholder);
      }

      partyCard.append(partyHead, partyList, placeholders);
      grid.appendChild(partyCard);
    });

    groupCard.append(groupHead, grid);
    elements.groupsContainer.appendChild(groupCard);
  });
}

function renderResults() {
  elements.resultsList.innerHTML = "";
  const visibleResults = getVisibleResultCharacters();

  if (!visibleResults.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    const emptyMessage = state.results.length && state.stash.length
      ? "현재 검색 결과는 모두 보관함으로 이동했습니다."
      : "아직 불러온 캐릭터가 없습니다.";
    emptyState.innerHTML = `
      <div>
        ${emptyMessage}<br />
        상단 검색으로 AION2 캐릭터를 먼저 가져오세요.
      </div>
    `;
    elements.resultsList.appendChild(emptyState);
    return;
  }

  visibleResults.forEach((character) => {
    elements.resultsList.appendChild(createResultCharacterCard(character));
  });
}

function renderStash() {
  elements.stashContainer.innerHTML = "";

  if (!state.stash.length) {
    elements.stashContainer.appendChild(createStashDropZone(0, true));
    return;
  }

  const stashList = document.createElement("div");
  stashList.className = "stash-list";

  state.stash.forEach((character, index) => {
    stashList.appendChild(createStashCharacterCard(character, index));
  });
  stashList.appendChild(createStashDropZone(state.stash.length, false));

  elements.stashContainer.appendChild(stashList);
}

function renderSearchStatus() {
  if (elements.searchHint) {
    const filteredCount = Number(state.ui.searchMeta?.filteredOutCount || 0);
    elements.searchHint.textContent = filteredCount > 0
      ? `아이템 레벨이 1000 이하인 캐릭터 ${filteredCount}명은 검색 결과에서 제외되었습니다.`
      : "아이템 레벨이 1000 이하인 캐릭터는 검색 결과에 표시되지 않습니다.";
  }

  if (state.ui.searchLoading) {
    elements.searchStatus.textContent = "AION2 공식 검색/캐릭터 정보 API에서 캐릭터를 조회하는 중입니다.";
    return;
  }

  if (state.ui.searchMeta?.searchPath) {
    const sortLabel = state.settings.sortBy === "itemLevel" ? "아이템 레벨 순" : "전투력 순";
    const filteredLabel = Number(state.ui.searchMeta?.filteredOutCount || 0) > 0
      ? ` · ${state.ui.searchMeta.filteredOutCount}명 제외`
      : "";
    elements.searchStatus.textContent =
      `마지막 조회: ${sortLabel} · 아이템 레벨 1000 이하 제외${filteredLabel} · 검색 API ${state.ui.searchMeta.searchPath}`;
    return;
  }

  elements.searchStatus.textContent = "AION2 서버와 캐릭터명을 입력한 뒤 검색하세요.";
}

function createResultCharacterCard(character) {
  const location = findCharacterPlacement(character.id);
  const card = createCharacterCard(character, {
    compact: false,
    source: {
      type: "results",
      characterId: character.id
    }
  });

  if (location) {
    const chip = document.createElement("div");
    chip.className = "assignment-chip";
    chip.textContent = `${location.groupNumber}그룹 ${location.partyNumber}파티 배치됨`;
    card.appendChild(chip);
    card.classList.add("is-assigned");
  }

  return card;
}

function createPartyCharacterCard(character, groupId, partyIndex, index) {
  const wrapper = document.createElement("div");
  wrapper.className = "drop-target";

  wrapper.addEventListener("dragover", handleDragOver);
  wrapper.addEventListener("dragleave", handleDragLeave);
  wrapper.addEventListener("drop", (event) => {
    handleDragLeave(event);
    const payload = readDragPayload(event);
    if (!payload) {
      return;
    }

    moveCharacterToParty(payload, groupId, partyIndex, index);
  });

  const card = createCharacterCard(character, {
    compact: true,
    onRemove: () => removeCharacterFromParty(character.id),
    source: {
      type: "party",
      characterId: character.id,
      groupId,
      partyIndex,
      index
    }
  });

  wrapper.appendChild(card);
  return wrapper;
}

function createStashCharacterCard(character, index) {
  const wrapper = document.createElement("div");
  wrapper.className = "stash-drop-target";

  wrapper.addEventListener("dragover", handleDragOver);
  wrapper.addEventListener("dragleave", handleDragLeave);
  wrapper.addEventListener("drop", (event) => {
    handleDragLeave(event);
    const payload = readDragPayload(event);
    if (!payload) {
      return;
    }

    moveCharacterToStash(payload, index);
  });

  const card = createCharacterCard(character, {
    compact: false,
    source: {
      type: "stash",
      characterId: character.id,
      index
    }
  });

  wrapper.appendChild(card);
  return wrapper;
}

function createEndDropZone(groupId, partyIndex, insertIndex) {
  const zone = document.createElement("div");
  zone.className = "drop-target drop-target-end";
  zone.textContent = "여기로 드롭해 파티 끝에 추가";
  zone.addEventListener("dragover", handleDragOver);
  zone.addEventListener("dragleave", handleDragLeave);
  zone.addEventListener("drop", (event) => {
    handleDragLeave(event);
    const payload = readDragPayload(event);
    if (!payload) {
      return;
    }

    moveCharacterToParty(payload, groupId, partyIndex, insertIndex);
  });
  return zone;
}

function createEmptyDropZone(groupId, partyIndex) {
  const zone = document.createElement("div");
  zone.className = "drop-target drop-target-empty";
  zone.innerHTML = `
    <div class="drop-copy">
      검색 결과 또는 다른 파티의 캐릭터를<br />
      여기로 드래그하세요.
    </div>
  `;
  zone.addEventListener("dragover", handleDragOver);
  zone.addEventListener("dragleave", handleDragLeave);
  zone.addEventListener("drop", (event) => {
    handleDragLeave(event);
    const payload = readDragPayload(event);
    if (!payload) {
      return;
    }

    moveCharacterToParty(payload, groupId, partyIndex, 0);
  });
  return zone;
}

function createStashDropZone(insertIndex, isEmpty) {
  const zone = document.createElement("div");
  zone.className = `stash-drop-target stash-drop-zone${isEmpty ? " is-empty" : ""}`;
  zone.innerHTML = isEmpty
    ? `
      <div class="drop-copy">
        검색 결과나 파티 카드를<br />
        여기로 드래그해 임시 보관하세요.
      </div>
    `
    : "여기로 드롭해 보관함 끝에 추가";

  zone.addEventListener("dragover", handleDragOver);
  zone.addEventListener("dragleave", handleDragLeave);
  zone.addEventListener("drop", (event) => {
    handleDragLeave(event);
    const payload = readDragPayload(event);
    if (!payload) {
      return;
    }

    moveCharacterToStash(payload, insertIndex);
  });

  return zone;
}

function createCharacterCard(character, options) {
  const card = document.createElement("article");
  card.className = `character-card${options.compact ? " is-compact" : ""}`;
  card.draggable = true;

  card.addEventListener("dragstart", (event) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", JSON.stringify(options.source));
  });

  const layout = document.createElement("div");
  layout.className = "character-layout";

  const main = document.createElement("div");
  main.className = "character-main";

  const top = document.createElement("div");
  top.className = "character-top";

  const titleWrap = document.createElement("div");
  titleWrap.className = "character-title-wrap";
  const name = document.createElement("p");
  name.className = "character-name";
  name.textContent = character.name;

  const sub = document.createElement("div");
  sub.className = "character-sub";
  const serverLabel = [character.worldName, character.serverName].filter(Boolean).join(" · ");
  sub.textContent = serverLabel || "서버 정보 없음";

  titleWrap.append(name, sub);
  top.appendChild(titleWrap);

  const meta = document.createElement("div");
  meta.className = "character-meta";

  const className = document.createElement("div");
  className.className = "character-class";
  if (character.classIconUrl) {
    const icon = document.createElement("img");
    icon.className = "class-icon";
    icon.src = character.classIconUrl;
    icon.alt = `${character.className || "직업"} 아이콘`;
    icon.loading = "lazy";
    className.appendChild(icon);
  }

  const classLabel = document.createElement("span");
  classLabel.textContent = character.className || "미확인";
  className.appendChild(classLabel);

  meta.appendChild(className);
  main.append(top, meta);

  const side = document.createElement("div");
  side.className = "character-side";

  const actions = document.createElement("div");
  actions.className = "character-actions";

  if (typeof options.onRemove === "function") {
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "card-remove-btn";
    removeButton.draggable = false;
    removeButton.textContent = "제거";
    removeButton.addEventListener("mousedown", (event) => event.stopPropagation());
    removeButton.addEventListener("dragstart", (event) => event.preventDefault());
    removeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      options.onRemove();
    });
    actions.appendChild(removeButton);
    side.appendChild(actions);
  }

  const metrics = document.createElement("div");
  metrics.className = "metric-grid";
  metrics.append(
    createMetricBlock("전투력", formatPower(character.combatPower)),
    createMetricBlock("아이템 레벨", formatPower(character.itemLevel))
  );

  side.appendChild(metrics);
  layout.append(main, side);
  card.append(layout);
  return card;
}

function createMetricBlock(label, value) {
  const block = document.createElement("div");
  block.className = "metric-block";
  block.innerHTML = `
    <span class="metric-label">${label}</span>
    <strong class="metric-value">${value}</strong>
  `;
  return block;
}

function clearGroup(groupId) {
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) {
    return;
  }

  const releasedCharacters = flattenGroupCharacters(group);
  if (!releasedCharacters.length) {
    showToast("이미 비어 있는 그룹입니다.", "warn");
    return;
  }

  if (!window.confirm("이 그룹의 배치 인원을 모두 해제할까요?")) {
    return;
  }

  group.parties = [[], []];
  state.results = mergeCharacters(state.results, releasedCharacters, false);
  persistState();
  render();
  showToast("그룹 인원을 모두 해제했습니다.");
}

function moveCharacterToParty(payload, targetGroupId, targetPartyIndex, insertIndex) {
  const character = resolveCharacter(payload);
  if (!character) {
    showToast("이동할 캐릭터 정보를 찾지 못했습니다.", "error");
    return;
  }

  const placement = findCharacterPlacement(character.id);
  const targetGroup = state.groups.find((group) => group.id === targetGroupId);
  const targetParty = targetGroup?.parties[targetPartyIndex];

  if (!targetParty) {
    return;
  }

  const sameParty = placement
    && placement.groupId === targetGroupId
    && placement.partyIndex === targetPartyIndex;

  if (!sameParty && targetParty.length >= 4) {
    showToast("한 파티에는 최대 4명까지만 배치할 수 있습니다.", "warn");
    return;
  }

  if (payload.type === "party") {
    removeCharacterFromGroups(character.id);
  } else if (payload.type === "stash") {
    removeCharacterFromStash(character.id);
  }

  let safeIndex = Math.max(0, Math.min(insertIndex, targetParty.length));
  if (sameParty && placement.index < insertIndex) {
    safeIndex -= 1;
  }

  targetParty.splice(safeIndex, 0, character);
  persistState();
  render();

  const groupNumber = state.groups.findIndex((group) => group.id === targetGroupId) + 1;
  showToast(`${character.name}을 ${groupNumber}그룹 ${targetPartyIndex + 1}파티로 이동했습니다.`);
}

function moveCharacterToStash(payload, insertIndex) {
  const character = resolveCharacter(payload);
  if (!character) {
    showToast("보관할 캐릭터 정보를 찾지 못했습니다.", "error");
    return;
  }

  const existingIndex = state.stash.findIndex((item) => item.id === character.id);
  const isSameStash = payload.type === "stash" && existingIndex !== -1;

  if (!isSameStash && existingIndex !== -1) {
    showToast("이미 보관함에 있는 캐릭터입니다.", "warn");
    return;
  }

  if (payload.type === "party") {
    removeCharacterFromGroups(character.id);
  } else if (payload.type === "stash") {
    removeCharacterFromStash(character.id);
  }

  let safeIndex = Math.max(0, Math.min(insertIndex, state.stash.length));
  if (isSameStash && existingIndex < insertIndex) {
    safeIndex -= 1;
  }

  state.stash.splice(safeIndex, 0, character);
  persistState();
  render();
  showToast(`${character.name}을 보관함에 추가했습니다.`);
}

function handleDropToReleaseZone(event) {
  handleDragLeave(event);
  const payload = readDragPayload(event);
  if (!payload || !["party", "stash"].includes(payload.type)) {
    return;
  }

  const character = payload.type === "party"
    ? removeCharacterFromGroups(payload.characterId)
    : removeCharacterFromStash(payload.characterId);
  if (!character) {
    return;
  }

  state.results = mergeCharacters(state.results, [character], false);
  persistState();
  render();
  showToast(`${character.name}의 파티 배치를 해제했습니다.`);
}

function resolveCharacter(payload) {
  if (payload.type === "results") {
    return cloneCharacter(state.results.find((character) => character.id === payload.characterId));
  }

  if (payload.type === "stash") {
    return cloneCharacter(state.stash.find((character) => character.id === payload.characterId));
  }

  if (payload.type === "party") {
    const placement = findCharacterPlacement(payload.characterId);
    if (!placement) {
      return null;
    }

    return cloneCharacter(state.groups[placement.groupIndex].parties[placement.partyIndex][placement.index]);
  }

  return null;
}

function removeCharacterFromGroups(characterId) {
  for (const group of state.groups) {
    for (const party of group.parties) {
      const index = party.findIndex((character) => character.id === characterId);
      if (index !== -1) {
        return party.splice(index, 1)[0];
      }
    }
  }
  return null;
}

function removeCharacterFromStash(characterId) {
  const index = state.stash.findIndex((character) => character.id === characterId);
  if (index === -1) {
    return null;
  }

  return state.stash.splice(index, 1)[0];
}

function removeGroup(groupId) {
  const groupIndex = state.groups.findIndex((group) => group.id === groupId);
  if (groupIndex === -1) {
    return;
  }

  const group = state.groups[groupIndex];
  const characterCount = group.parties[0].length + group.parties[1].length;
  const message = characterCount
    ? "이 그룹을 삭제하면 배치된 캐릭터는 검색 결과 목록으로 돌아갑니다. 계속할까요?"
    : "이 그룹을 삭제할까요?";

  if (!window.confirm(message)) {
    return;
  }

  state.results = mergeCharacters(state.results, flattenGroupCharacters(group), false);
  state.groups.splice(groupIndex, 1);
  persistState();
  render();
  showToast("그룹을 삭제했습니다.");
}

function removeCharacterFromParty(characterId) {
  const character = removeCharacterFromGroups(characterId);
  if (!character) {
    return;
  }

  state.results = mergeCharacters(state.results, [character], false);
  persistState();
  render();
  showToast(`${character.name}을 검색 결과로 되돌렸습니다.`);
}

function mergeCharacters(existingCharacters, incomingCharacters, replace) {
  const nextMap = new Map();

  if (!replace) {
    existingCharacters.forEach((character) => {
      nextMap.set(character.id, cloneCharacter(character));
    });
  }

  incomingCharacters.forEach((character) => {
    const normalized = normalizeCharacter(character);
    if (!normalized) {
      return;
    }

    const previous = nextMap.get(normalized.id);
    nextMap.set(normalized.id, {
      ...previous,
      ...normalized
    });
  });

  return sortResultCharacters(Array.from(nextMap.values()));
}

function syncAssignedCardsWithResults(results) {
  const resultMap = new Map(results.map((character) => [character.id, character]));

  state.groups.forEach((group) => {
    group.parties.forEach((party, partyIndex) => {
      group.parties[partyIndex] = party.map((character) => {
        const synced = resultMap.get(character.id);
        return synced ? { ...character, ...synced } : character;
      });
    });
  });
}

function syncStashedCardsWithResults(results) {
  const resultMap = new Map(results.map((character) => [character.id, character]));
  state.stash = state.stash.map((character) => {
    const synced = resultMap.get(character.id);
    return synced ? { ...character, ...synced } : character;
  });
}

function findCharacterPlacement(characterId) {
  for (let groupIndex = 0; groupIndex < state.groups.length; groupIndex += 1) {
    const group = state.groups[groupIndex];
    for (let partyIndex = 0; partyIndex < group.parties.length; partyIndex += 1) {
      const party = group.parties[partyIndex];
      const index = party.findIndex((character) => character.id === characterId);
      if (index !== -1) {
        return {
          groupId: group.id,
          groupIndex,
          groupNumber: groupIndex + 1,
          index,
          partyIndex,
          partyNumber: partyIndex + 1
        };
      }
    }
  }

  return null;
}

function flattenAssignedCharacters() {
  return state.groups.flatMap((group) => flattenGroupCharacters(group));
}

function flattenGroupCharacters(group) {
  return group.parties.flatMap((party) => party.map(cloneCharacter));
}

function cloneCharacter(character) {
  return character ? { ...character } : null;
}

function persistState() {
  if (session.isApplyingRemote) {
    return;
  }

  if (session.mode === "server") {
    scheduleServerSave();
    return;
  }

  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(exportBoardState()));
}

function exportBoardState(sourceState = state) {
  return {
    nextGroupId: sourceState.nextGroupId,
    groups: sourceState.groups,
    results: sourceState.results,
    stash: sourceState.stash,
    settings: sourceState.settings,
    ui: {
      searchMeta: sourceState.ui.searchMeta
    }
  };
}

function scheduleServerSave() {
  if (session.mode !== "server" || !session.boardCode) {
    return;
  }

  clearTimeout(session.saveTimer);
  session.saveTimer = window.setTimeout(() => {
    saveServerBoard().catch((error) => {
      if (isUnavailableSharedBoardError(error)) {
        handleUnavailableSharedBoard(error);
        return;
      }

      showToast(error.message || "서버 보드를 저장하지 못했습니다.", "error");
    });
  }, SERVER_SAVE_DEBOUNCE_MS);
}

async function saveServerBoard() {
  if (session.mode !== "server" || !session.boardCode) {
    return;
  }

  session.isSaving = true;
  session.statusMessage = "서버에 저장 중입니다.";
  renderSharePanel();

  try {
    const response = await requestBoardApi("save", {
      method: "POST",
      body: {
        boardCode: session.boardCode,
        state: exportBoardState()
      }
    });

    session.lastServerUpdatedAt = response.updatedAt || session.lastServerUpdatedAt;
    session.statusMessage = `공유 보드 저장 완료 · 코드 ${session.boardCode}`;
  } catch (error) {
    if (isUnavailableSharedBoardError(error)) {
      handleUnavailableSharedBoard(error);
      return;
    }

    throw error;
  } finally {
    session.isSaving = false;
    renderSharePanel();
  }
}

function startServerSync() {
  stopServerSync();

  if (session.mode !== "server" || !session.boardCode) {
    return;
  }

  session.syncTimer = window.setInterval(() => {
    syncServerBoard({ silent: true }).catch((error) => {
      if (isUnavailableSharedBoardError(error)) {
        handleUnavailableSharedBoard(error);
      }
    });
  }, SERVER_POLL_INTERVAL_MS);
}

function stopServerSync() {
  clearTimeout(session.saveTimer);
  clearInterval(session.syncTimer);
  session.saveTimer = null;
  session.syncTimer = null;
  session.isSaving = false;
}

async function syncServerBoard({ silent }) {
  if (session.mode !== "server" || !session.boardCode) {
    return false;
  }

  const response = await requestBoardApi("load", {
    method: "GET",
    boardCode: session.boardCode
  });

  if (!response.updatedAt) {
    return false;
  }

  if (session.lastServerUpdatedAt && response.updatedAt <= session.lastServerUpdatedAt) {
    return false;
  }

  session.isApplyingRemote = true;
  state = normalizeStoredState(response.state, createDefaultState());
  session.lastServerUpdatedAt = response.updatedAt;
  session.statusMessage = silent
    ? "공유 보드의 최신 편성을 반영했습니다."
    : "공유 보드 편성을 다시 불러왔습니다.";
  session.isApplyingRemote = false;
  render();
  return true;
}

function readBoardCodeFromLocation() {
  const params = new URLSearchParams(window.location.search);
  const boardCode = params.get(BOARD_CODE_PARAM) || "";
  return normalizeBoardCodeInput(boardCode);
}

function setBoardCodeInLocation(boardCode, options = {}) {
  const url = new URL(window.location.href);
  url.searchParams.set(BOARD_CODE_PARAM, boardCode);
  const method = options.replace === false ? "pushState" : "replaceState";
  window.history[method]({}, "", url.toString());
}

function clearBoardCodeInLocation(options = {}) {
  const url = new URL(window.location.href);
  url.searchParams.delete(BOARD_CODE_PARAM);
  const method = options.replace === false ? "pushState" : "replaceState";
  window.history[method]({}, "", url.toString());
}

function normalizeBoardCodeInput(value) {
  const boardCode = String(value || "").trim();
  return /^[A-Za-z0-9]{8}$/.test(boardCode) ? boardCode : "";
}

function getShareLink(boardCode) {
  const url = new URL(window.location.href);
  url.searchParams.set(BOARD_CODE_PARAM, boardCode);
  return url.toString();
}

async function requestBoardApi(action, options) {
  const params = new URLSearchParams({ action });

  if (options.method === "GET" && options.boardCode) {
    params.set("boardCode", options.boardCode);
  }

  const requestOptions = {
    method: options.method,
    headers: {
      "Content-Type": "application/json"
    }
  };

  if (options.method !== "GET") {
    requestOptions.body = JSON.stringify(options.body || {});
  }

  const response = await fetch(`/.netlify/functions/party-board?${params.toString()}`, requestOptions);
  const payload = await response.json();

  if (!response.ok) {
    const error = new Error(payload.error || "서버 보드 요청에 실패했습니다.");
    error.statusCode = response.status;
    throw error;
  }

  return payload;
}

function isUnavailableSharedBoardError(error) {
  return Number(error?.statusCode) === 404;
}

function formatPower(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "미확인";
  }

  return new Intl.NumberFormat("ko-KR").format(Math.round(value));
}

function readDragPayload(event) {
  event.preventDefault();
  try {
    const raw = event.dataTransfer.getData("text/plain");
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function handleDragOver(event) {
  event.preventDefault();
  event.currentTarget.classList.add("is-over");
  event.dataTransfer.dropEffect = "move";
}

function handleDragLeave(event) {
  event.currentTarget.classList.remove("is-over");
}

function showToast(message, tone = "info") {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.dataset.tone = tone;
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 2200);
}

function sortResultCharacters(characters) {
  const primaryKey = state.settings.sortBy === "itemLevel" ? "itemLevel" : "combatPower";
  const secondaryKey = primaryKey === "combatPower" ? "itemLevel" : "combatPower";

  return characters
    .filter((character) => (character.itemLevel ?? 0) > 1000)
    .slice()
    .sort((left, right) => {
      const primaryDiff = compareMetric(right[primaryKey], left[primaryKey]);
      if (primaryDiff !== 0) {
        return primaryDiff;
      }

      const secondaryDiff = compareMetric(right[secondaryKey], left[secondaryKey]);
      if (secondaryDiff !== 0) {
        return secondaryDiff;
      }

      return left.name.localeCompare(right.name, "ko");
    });
}

function compareMetric(left, right) {
  return (left ?? 0) - (right ?? 0);
}

function getVisibleResultCharacters() {
  const stashedIds = new Set(state.stash.map((character) => character.id));
  return state.results.filter((character) => !stashedIds.has(character.id));
}
