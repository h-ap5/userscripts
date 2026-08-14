// ==UserScript==
// @name         📝 크랙 요약 메모리 편집 & AI 자동 정리
// @namespace    https://crack.wrtn.ai/
// @version      2.3.2
// @updateURL    https://raw.githubusercontent.com/h-ap5/userscripts/main/scripts/automemory.user.js
// @downloadURL  https://raw.githubusercontent.com/h-ap5/userscripts/main/scripts/automemory.user.js
// @homepageURL  https://github.com/h-ap5/userscripts
// @description  크랙 내부 장기기억 요약·누적형 자동 정리·구간/상한 압축·일괄편집·다중 AI API(Vertex JSON 포함)·자동 전용 프롬프트 슬롯·추론/토큰/비용기록·내보내기
// @author       User
// @match        https://crack.wrtn.ai/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      oauth2.googleapis.com
// @connect      googleapis.com
// @sandbox      DOM
// @inject-into  content
// @run-at       document-idle
// ==/UserScript==


(function () {
    'use strict';

    const API_BASE = 'https://crack-api.wrtn.ai/crack-gen/v3/chats';
    const AI_RESULT_DRAFTS = new Map();
    const UI_ICONS = Object.freeze({
        memory:'<svg class="crack-ext-ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h12A1.5 1.5 0 0 1 19.5 5v14a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5Z"/><path d="M8.5 8h7M8.5 11.5h7M8.5 15h4"/></svg>',
        flask:'<svg class="crack-ext-ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6M10 3v5.5L4.8 17a2 2 0 0 0 1.8 3h10.8a2 2 0 0 0 1.8-3L14 8.5V3"/><path d="M7.5 14h9"/></svg>',
        edit:'<svg class="crack-ext-ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
        sparkle:'<svg class="crack-ext-ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.7 4.6L18 9.2l-4.3 1.6L12 15.5l-1.7-4.7L6 9.2l4.3-1.6Z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z"/></svg>',
        plus:'<svg class="crack-ext-ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
        save:'<svg class="crack-ext-ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v15H5Z"/><path d="M8 3v6h8V3M8 15h8v6H8Z"/></svg>',
        info:'<svg class="crack-ext-ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9"/></svg>',
        close:'<svg class="crack-ext-ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'
    });

    // ============== 저장 한도 / 전체 범위 처리 ==============
    // 제목·본문 제한은 미리보기와 저장 검증에만 사용하며, AI의 출력 형식에는 개입하지 않습니다.
    const GENERATED_TITLE_MAX = 20;
    const GENERATED_SUMMARY_MAX = 300;
    const AUTO_MEMORY_SETTINGS_PREFIX = 'crack_ext_auto_memory_settings_v2:';
    const AUTO_MEMORY_SETTINGS_GM_PREFIX = 'crack_ext_auto_memory_settings_v4:';
    const AUTO_MEMORY_SETTINGS_AUTOSAVE_MS = 600;
    const AUTO_MEMORY_STATE_PREFIX = 'crack_ext_auto_memory_state_v1:';
    const AUTO_MEMORY_LOCK_PREFIX = 'crack_ext_auto_memory_lock_v1:';
    const AUTO_MEMORY_LOCK_MS = 600000;
    const AUTO_MEMORY_LOCK_HEARTBEAT_MS = 60000;
    const AUTO_MEMORY_RETRY_DELAYS = Object.freeze([60000, 300000]);
    const AUTO_MEMORY_RESPONSE_DEBOUNCE_MS = 4000;
    const AUTO_MEMORY_SLOT_RECHECK_DELAYS = Object.freeze([10000, 20000, 40000, 60000]);
    const AUTO_MEMORY_WAKE_THROTTLE_MS = 15000;
    const AUTO_MEMORY_SESSION_ID = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    const AUTO_MEMORY_DEFAULTS = Object.freeze({
        enabled:false,
        intervalTurns:10,
        readTurns:10,
        excludeRecentTurns:1,
        contextCards:5,
        midMergeTurns:10,
        maxCards:20,
        compactTarget:16,
        protectUserAdded:true
    });
    let AUTO_MEMORY_BUSY = false;
    let AUTO_MEMORY_RESPONSE_TIMER = 0;
    let AUTO_MEMORY_SLOT_TIMER = 0;
    let AUTO_MEMORY_RETRY_TIMER = 0;
    let AUTO_MEMORY_SLOT_RECHECK_INDEX = 0;
    let AUTO_MEMORY_LAST_WAKE_AT = 0;
    let AUTO_MEMORY_SETTINGS_LAST_WRITE_AT = 0;
    const AUTO_MEMORY_SETTINGS_REPLAN_REQUESTED_CHATS = new Set();
    const AUTO_MEMORY_SETTINGS_EDIT_PENDING_CHATS = new Set();

    const AUTO_MEMORY_CONTINUITY_REQUIREMENT = `[BATCH CONTINUITY]
Batch cuts are artificial. Treat trusted memories as authoritative prior state. Preserve unchanged facts. Continue, revise, or merge the same event; fix premature endings and overlap. Split only when the narrative thread truly changes. Return the complete deduplicated replacement set for EDITABLE, RECOVERY, and NEW content only.`;

    const AUTO_MEMORY_SCOPE_REQUIREMENT = `[AUTOMATION SCOPE OVERRIDE]
For this automatic run, output coverage is limited to EDITABLE TRUSTED MEMORIES, RECOVERY MEMORIES, and NEW DIALOGUE. PROTECTED TRUSTED MEMORIES are reference-only, outside FULL INPUT COVERAGE, and must never be copied or paraphrased into output cards.`;

    const AUTO_MEMORY_REWRITE_REQUIREMENT = `[AUTO MEMORY REWRITE]
- Disposable native slots are storage IDs only. Ignore their old title and body as facts.
- Protected memories are context only. Do not repeat or rewrite their unchanged content.
- Recovery memories lost their live slot. Merge every still-valid fact from them into the replacement.
- Editable memories must be returned as a complete updated replacement together with the new dialogue.
- If new dialogue continues the same event, revise and extend the prior memory instead of duplicating it.
- Remove duplicate, obsolete, or redundant restatements without dropping causal, relational, contractual, identity, or world-state facts.`;

    const AUTO_MEMORY_FORMAT_REQUIREMENT = `[AUTO-SAVE FORMAT — AUTOMATION OVERRIDE]
For this automatic run, this block overrides any conflicting output-format instruction.
Return cards only as:
[title]
summary
Title: 1–20 characters. Summary: exactly one line, 1–300 characters. Put one blank line between cards. No fences, numbering, commentary, or summary starting with "[". Return cards oldest to newest.`;

    const AUTO_MEMORY_SYSTEM_REQUIREMENTS = [
        AUTO_MEMORY_SCOPE_REQUIREMENT,
        AUTO_MEMORY_CONTINUITY_REQUIREMENT,
        AUTO_MEMORY_REWRITE_REQUIREMENT,
        AUTO_MEMORY_FORMAT_REQUIREMENT
    ].join('\n\n');

    const AUTO_MEMORY_APPEND_SYSTEM_REQUIREMENTS = `[AUTOMATION APPEND MODE — HIGHEST PRIORITY]
This automatic run is append-first, not a global rewrite.
- SEALED MEMORIES and PROTECTED MEMORIES are reference-only. Never copy, rewrite, merge, or delete them.
- OPEN TAIL may be updated only when NEW DIALOGUE directly continues, corrects, or concludes that same causal event. Otherwise keep it unchanged.
- Independent new event arcs must become separate newCards in chronological order. Do not merge independent arcs merely to fit capacity.
- FRESH assistant slots are empty storage containers. Ignore their old title/body as facts.
- RECOVERY MEMORIES contain facts from a managed card whose live slot changed or disappeared. Preserve every still-valid fact in an updated tail or new card.
- If all essential independent arcs cannot fit in FRESH SLOT CAPACITY, return WAIT_FOR_SLOT. Never partially save or omit later facts.
- Batch endings are artificial. Do not invent closure.

[AUTOMATION JSON FORMAT — OVERRIDES USER OUTPUT FORMAT]
Return exactly one JSON object and no markdown fence, commentary, or surrounding text:
{"version":1,"decision":"APPLY","tail":{"action":"KEEP","title":"","summary":""},"newCards":[{"title":"...","summary":"..."}]}
decision is APPLY or WAIT_FOR_SLOT.
tail.action is KEEP or UPDATE. KEEP requires empty title and summary. UPDATE requires the complete replacement title and summary for OPEN TAIL.
If there is no OPEN TAIL, tail.action must be KEEP.
WAIT_FOR_SLOT requires KEEP with empty fields and an empty newCards array.
Each JSON title value is raw title text without "[" or "]". Brackets requested by the user prompt are presentation delimiters only; omit them inside JSON. Each title is 1–20 characters. Each summary is one physical line, 1–300 characters, with no carriage return or line feed. Do not start a summary with "[".
For APPLY, return at least one real UPDATE or one newCards entry.`;

    const AUTO_MEMORY_COMPACTION_REQUIREMENT = `[AUTOMATION COMPACTION OVERRIDE]
Only the memories under EDITABLE COMPACTION TARGETS belong in the replacement output. PROTECTED CONTEXT is reference-only and must not be copied as a separate card. Follow the run-specific output count or range, and return cards oldest to newest. Preserve independent anchors, causal links, relationships, promises, identity, and world-state facts before trimming detail.`;

    // 사용자 프롬프트의 형식에는 관여하지 않고, 전달된 입력 전체를 끝까지 처리하도록 요구합니다.
    const BUILTIN_FULL_COVERAGE_REQUIREMENT = `[FULL INPUT COVERAGE — HIGHEST PRIORITY]
Process the entire provided input from beginning to end before producing the final answer.
Do not process only an early portion and stop.
Do not omit later events, entries, or important information merely to shorten the response.
Follow the selected user prompt exactly for output format, grouping, style, language, and level of detail.
This requirement controls coverage only. It must not change or add any output format, grouping rule, slot rule, writing style, or content rule.`;

    // ============== 1차 요약 프롬프트 ==============
    const DEFAULT_PROMPT = `# 📔 장기기억 아카이브 요약 프롬프트

## 🎯 목적
채팅 로그를 분석하여 이후 서사가 어긋나지 않도록 핵심 사실, 사건의 인과, 관계 변화, 약속, 설정과 감정선의 변화를 장기기억으로 정리한다.

## 🧩 기억 묶음 기준
- 출력 단위는 사소한 행동 하나가 아니라 **연속된 사건 흐름 하나**다.
- 같은 장면에서 이어지는 원인, 행동, 반응, 결과, 관계 변화는 가능한 한 한 슬롯에 묶는다.
- 장소·시간·화자·등장인물이 바뀌었다는 이유만으로 자동 분리하지 않는다.
- 서로 무관한 서사 축이거나, 핵심 정보를 보존한 채 300자 안으로 정리할 수 없을 때만 분리한다.
- 슬롯 수를 늘리는 것보다 한 슬롯을 정보 밀도 높게 완성하는 것을 우선한다.

## 📋 출력 내용
- 제목에는 NPC명, 조직명, 장소명, 물건명, 핵심 사건명처럼 다시 검색하기 좋은 고유명사를 우선한다.
- 본문 첫머리에 로그에 존재하는 날짜·시간대가 있으면 기록한다.
- 대명사 대신 정확한 이름을 사용한다.
- 사건 배경, 원인, 구체적 행동, 반응, 결과, 관계 변화와 이후 플롯에 필요한 정보를 보존한다.
- 단순한 반복 대화와 의미 없는 분위기 묘사는 줄이되, 관계 변화를 설명하는 감정은 사실 형태로 남긴다.
- 요약체(~함, ~됨, ~임)를 사용한다.

## 🚫 금지
- 같은 흐름을 행동별로 잘게 쪼개기
- 짧은 슬롯을 많이 만들기
- 시간 순서 변경
- 원인과 결과 누락
- 새로운 사실 창작
- 형식 밖의 해설 출력`;

    // ============== 2차 압축 프롬프트 ==============
    const COMPRESS_PROMPT = `# 롤플레잉 로그 장기기억 압축정리 지침

## 목적
입력된 장기기억들을 시맨틱 검색으로 다시 불러오기 좋은 고밀도 기억 묶음으로 압축한다.
장면별 재출력이 아니라 관련된 날짜, 사건, 인과관계, 설정과 조직 변화를 최소한의 슬롯으로 묶는 것이 목표다.

## 처리 원칙
1. 전체를 시간순으로 읽고 같은 사건 축, 인물 관계, 조직, 음모, 계약, 전쟁, 혈통, 추적처럼 함께 검색되어야 하는 정보를 묶는다.
2. 한 슬롯에 여러 날짜와 여러 에피소드가 들어갈 수 있다.
3. 장소·날짜·등장인물 변화만으로 분리하지 않는다.
4. 300자 안에서 핵심을 보존할 수 있으면 반드시 병합한다.
5. 본문은 230~300자를 목표로 하며, 200자 미만이면 인접한 관련 정보와 병합한다.
6. 300자를 넘는 경우에만 최소 개수로 균형 있게 분리한다. 300자·300자·짧은 잔여 슬롯처럼 나누지 않는다.
7. 감정은 이후 행동의 원인이거나 관계 상태를 바꾼 경우에만 사실 형태로 기록한다.
8. 사망, 출생, 계약, 배신, 조직 변화, 원인과 결과, 인물의 결정, 세계관 설정과 고유명사는 끝까지 남긴다.
9. 없는 날짜나 사실을 만들지 않는다.

## 문체
- 한국어 압축 연표체
- 짧고 명확한 문장
- 가능하면 ~함, ~됨, ~결정함 형태
- 결과 외 해설 금지`;

    // ============== 프롬프트 슬롯 / API 설정 ==============
    const PROMPT_SLOT_KEYS = {
        main: 'crack_ext_prompt_slots_main_v2',
        auto: 'crack_ext_prompt_slots_auto_v2',
        compress: 'crack_ext_prompt_slots_compress_v2'
    };
    const PROMPT_ACTIVE_KEYS = {
        main: 'crack_ext_active_prompt_main_v2',
        auto: 'crack_ext_active_prompt_auto_v2',
        compress: 'crack_ext_active_prompt_compress_v2'
    };
    const LEGACY_PROMPT_KEYS = {
        main: 'crack_ext_custom_prompt',
        auto: 'crack_ext_auto_prompt',
        compress: 'crack_ext_compress_prompt'
    };

    function getDefaultPrompt(mode) {
        if (mode === 'compress') return COMPRESS_PROMPT;
        return DEFAULT_PROMPT;
    }

    function migrateBuiltInDefaultPrompt(mode, slots) {
        var defaultId = mode + '-default';
        var slot = slots.find(function(item) { return item && item.id === defaultId; });
        if (!slot || slot.name !== '기본 프롬프트') return false;
        var prompt = slot.prompt || '';
        var isLegacyMain = (mode === 'main' || mode === 'auto') && prompt.includes('분리 필수 조건') && prompt.includes('장소 이동') && prompt.includes('병합 금지');
        var isLegacyCompress = mode === 'compress' && prompt.includes('대괄호 안 제목은 공백 포함 20자 이내') && prompt.includes('180자 미만 항목');
        if (!isLegacyMain && !isLegacyCompress) return false;
        slot.prompt = getDefaultPrompt(mode);
        return true;
    }

    function makePromptSlotId(mode) {
        return mode + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    }

    function savePromptSlots(mode, slots) {
        localStorage.setItem(PROMPT_SLOT_KEYS[mode], JSON.stringify(slots));
    }

    function loadPromptSlots(mode) {
        var parsed = null;
        try {
            parsed = JSON.parse(localStorage.getItem(PROMPT_SLOT_KEYS[mode]) || 'null');
        } catch (e) {
            parsed = null;
        }

        if (Array.isArray(parsed) && parsed.length) {
            var normalized = parsed.filter(function(slot) {
                return slot && typeof slot.id === 'string' && typeof slot.name === 'string' && typeof slot.prompt === 'string';
            });
            if (normalized.length) {
                if (migrateBuiltInDefaultPrompt(mode, normalized)) savePromptSlots(mode, normalized);
                return normalized;
            }
        }

        var defaultPrompt = getDefaultPrompt(mode);
        var defaultSlot = {
            id: mode + '-default',
            name: '기본 프롬프트',
            prompt: defaultPrompt
        };
        var slots = [defaultSlot];
        var preferredSlot = defaultSlot;
        if (mode === 'auto') {
            var inheritedMain = getActivePromptSlot('main');
            if (inheritedMain && inheritedMain.prompt.trim() && inheritedMain.prompt.trim() !== defaultPrompt.trim()) {
                preferredSlot = {
                    id: makePromptSlotId(mode),
                    name: '현재 1차 프롬프트 복사',
                    prompt: inheritedMain.prompt
                };
                slots.push(preferredSlot);
            }
        }
        var legacy = localStorage.getItem(LEGACY_PROMPT_KEYS[mode]);
        if (legacy && legacy.trim()) {
            var matchingLegacySlot = slots.find(function(slot) { return slot.prompt.trim() === legacy.trim(); });
            if (matchingLegacySlot) {
                preferredSlot = matchingLegacySlot;
            } else {
                var legacySlot = {
                    id: makePromptSlotId(mode),
                    name: '기존 사용자 프롬프트',
                    prompt: legacy
                };
                slots.push(legacySlot);
                preferredSlot = legacySlot;
            }
        }
        localStorage.setItem(PROMPT_ACTIVE_KEYS[mode], preferredSlot.id);
        savePromptSlots(mode, slots);
        return slots;
    }

    function getActivePromptSlot(mode) {
        var slots = loadPromptSlots(mode);
        var activeId = localStorage.getItem(PROMPT_ACTIVE_KEYS[mode]);
        var active = slots.find(function(slot) { return slot.id === activeId; }) || slots[0];
        if (active.id !== activeId) localStorage.setItem(PROMPT_ACTIVE_KEYS[mode], active.id);
        return active;
    }

    function setActivePromptSlot(mode, slotId) {
        var slots = loadPromptSlots(mode);
        var active = slots.find(function(slot) { return slot.id === slotId; }) || slots[0];
        localStorage.setItem(PROMPT_ACTIVE_KEYS[mode], active.id);
        localStorage.setItem(LEGACY_PROMPT_KEYS[mode], active.prompt);
        return active;
    }

    function getActivePromptText(mode) {
        return getActivePromptSlot(mode).prompt || getDefaultPrompt(mode);
    }

    function updatePromptSlot(mode, slotId, changes) {
        var slots = loadPromptSlots(mode);
        var target = slots.find(function(slot) { return slot.id === slotId; });
        if (!target) return null;
        Object.assign(target, changes || {});
        savePromptSlots(mode, slots);
        if (localStorage.getItem(PROMPT_ACTIVE_KEYS[mode]) === target.id) {
            localStorage.setItem(LEGACY_PROMPT_KEYS[mode], target.prompt);
        }
        return target;
    }

    function getApiKeyStorageKey(provider) {
        if (provider === 'google') return 'crack_ext_gemini_key';
        if (provider === 'deepseek') return 'crack_ext_deepseek_key';
        if (provider === 'openai') return 'crack_ext_openai_key';
        return '';
    }

    function getSavedApiKey(provider) {
        var key = getApiKeyStorageKey(provider);
        return key ? (localStorage.getItem(key) || '') : '';
    }

    function saveApiKey(provider, value) {
        var key = getApiKeyStorageKey(provider);
        if (key) localStorage.setItem(key, value || '');
    }

    // 서비스 계정 JSON에는 장기 개인키가 포함되므로 페이지 localStorage에는 절대 저장하지 않는다.
    // GM 저장소를 지원하지 않는 환경에서는 현재 스크립트 세션 메모리에만 보관한다.
    var VERTEX_JSON_STORAGE_KEY = 'crack_ext_vertex_service_account_json_v1';
    var VERTEX_LOCATION_STORAGE_KEY = 'crack_ext_vertex_location';
    var VERTEX_PROJECT_STORAGE_KEY = 'crack_ext_vertex_project_id';
    var VERTEX_SESSION_JSON = null;
    var VERTEX_SESSION_PERSISTED = false;

    function getSavedVertexJson() {
        if (VERTEX_SESSION_JSON !== null) return VERTEX_SESSION_JSON;
        try {
            if (typeof GM_getValue === 'function') {
                return String(GM_getValue(VERTEX_JSON_STORAGE_KEY, '') || '');
            }
        } catch (e) {}
        return '';
    }

    function saveVertexJson(value, persist) {
        var normalized = String(value || '');
        VERTEX_SESSION_JSON = normalized;
        VERTEX_SESSION_PERSISTED = false;
        if (persist === false) return false;
        try {
            if (typeof GM_setValue === 'function') {
                GM_setValue(VERTEX_JSON_STORAGE_KEY, normalized);
                VERTEX_SESSION_PERSISTED = true;
                return true;
            }
        } catch (e) {}
        return false;
    }

    function hasPersistentVertexJson() {
        try {
            return typeof GM_getValue === 'function' && !!GM_getValue(VERTEX_JSON_STORAGE_KEY, '');
        } catch (e) {
            return false;
        }
    }

    function deleteVertexJson() {
        VERTEX_SESSION_JSON = '';
        VERTEX_SESSION_PERSISTED = false;
        try {
            if (typeof GM_deleteValue === 'function') {
                GM_deleteValue(VERTEX_JSON_STORAGE_KEY);
                return true;
            }
            if (typeof GM_setValue === 'function') {
                GM_setValue(VERTEX_JSON_STORAGE_KEY, '');
                return true;
            }
        } catch (e) {}
        return false;
    }

    function releaseVertexSessionSecrets() {
        VERTEX_SESSION_JSON = null;
        VERTEX_SESSION_PERSISTED = false;
        VERTEX_TOKEN_CACHE.clear();
    }

    function getSavedVertexLocation() {
        return localStorage.getItem(VERTEX_LOCATION_STORAGE_KEY) || 'global';
    }

    function getSavedVertexProjectId() {
        return localStorage.getItem(VERTEX_PROJECT_STORAGE_KEY) || '';
    }

    function saveVertexEndpointSettings(locationValue, projectIdValue) {
        localStorage.setItem(VERTEX_LOCATION_STORAGE_KEY, String(locationValue || '').trim() || 'global');
        localStorage.setItem(VERTEX_PROJECT_STORAGE_KEY, String(projectIdValue || '').trim());
    }

    function getDefaultModel(provider) {
        if (provider === 'google') return 'gemini-3.1-pro-preview';
        if (provider === 'vertex') return 'gemini-3.1-pro-preview';
        if (provider === 'deepseek') return 'deepseek-v4-flash';
        if (provider === 'firebase') return 'gemini-3.1-pro-preview';
        if (provider === 'openai') return 'gpt-5.6-luna';
        return '';
    }

    // ============== 유틸 함수 ==============
    function getChatId() {
        const patterns = [/\/episodes\/([a-z0-9_-]{8,})/i, /\/chats\/([a-z0-9_-]{8,})/i, /\/c\/([a-z0-9_-]{8,})/i];
        var routeSources = [location.pathname || '', location.hash || ''];
        for (var sourceIndex = 0; sourceIndex < routeSources.length; sourceIndex++) {
            for (var i = 0; i < patterns.length; i++) {
                var match = routeSources[sourceIndex].match(patterns[i]);
                if (match) return match[1];
            }
        }
        try {
            var params = new URLSearchParams(location.search || '');
            var queryId = params.get('chatId') || params.get('chat_id') || params.get('conversationId') || params.get('episodeId');
            if (/^[a-z0-9_-]{8,}$/i.test(String(queryId || ''))) return String(queryId);
            var hashQueryIndex = String(location.hash || '').indexOf('?');
            if (hashQueryIndex >= 0) {
                var hashParams = new URLSearchParams(String(location.hash).slice(hashQueryIndex + 1));
                var hashId = hashParams.get('chatId') || hashParams.get('chat_id') || hashParams.get('conversationId') || hashParams.get('episodeId');
                if (/^[a-z0-9_-]{8,}$/i.test(String(hashId || ''))) return String(hashId);
            }
        } catch (e) {}
        return null;
    }

    function normalizeAutoMemorySettingsChatId(chatId) {
        return String(chatId || '').trim();
    }

    function getAutoMemorySettingsStorageKey(chatId, useGmStorage) {
        var normalizedChatId = normalizeAutoMemorySettingsChatId(chatId);
        if (!normalizedChatId) return '';
        return (useGmStorage ? AUTO_MEMORY_SETTINGS_GM_PREFIX : AUTO_MEMORY_SETTINGS_PREFIX) + normalizedChatId;
    }

    function isAutoMemorySettingsEditPending(chatId) {
        var normalizedChatId = normalizeAutoMemorySettingsChatId(chatId);
        return !!normalizedChatId && AUTO_MEMORY_SETTINGS_EDIT_PENDING_CHATS.has(normalizedChatId);
    }

    function setAutoMemorySettingsEditPending(chatId, pending) {
        var normalizedChatId = normalizeAutoMemorySettingsChatId(chatId);
        if (!normalizedChatId) return;
        if (pending) AUTO_MEMORY_SETTINGS_EDIT_PENDING_CHATS.add(normalizedChatId);
        else AUTO_MEMORY_SETTINGS_EDIT_PENDING_CHATS.delete(normalizedChatId);
    }

    function requestAutoMemorySettingsReplan(chatId) {
        var normalizedChatId = normalizeAutoMemorySettingsChatId(chatId);
        if (normalizedChatId) AUTO_MEMORY_SETTINGS_REPLAN_REQUESTED_CHATS.add(normalizedChatId);
    }

    function consumeAutoMemorySettingsReplan(chatId) {
        var normalizedChatId = normalizeAutoMemorySettingsChatId(chatId);
        if (!normalizedChatId || !AUTO_MEMORY_SETTINGS_REPLAN_REQUESTED_CHATS.has(normalizedChatId)) return false;
        AUTO_MEMORY_SETTINGS_REPLAN_REQUESTED_CHATS.delete(normalizedChatId);
        return true;
    }

    function getAiResultDraftKey() {
        return getChatId() || location.pathname || 'current';
    }

    function getAiResultDraft() {
        return AI_RESULT_DRAFTS.get(getAiResultDraftKey()) || null;
    }

    function saveAiResultDraft(value, mode) {
        var text = String(value || '');
        var trimmed = text.trim();
        if (!trimmed) {
            AI_RESULT_DRAFTS.delete(getAiResultDraftKey());
            return;
        }
        if (trimmed === '요약 중...' || trimmed.startsWith('오류:')) return;
        AI_RESULT_DRAFTS.set(getAiResultDraftKey(), { text:text, mode:mode === 'compress' ? 'compress' : 'main' });
    }

    function clearAiResultDraft() {
        AI_RESULT_DRAFTS.delete(getAiResultDraftKey());
    }

    function clampInteger(value, min, max, fallback) {
        var parsed = parseInt(value, 10);
        if (!Number.isFinite(parsed)) parsed = fallback;
        return Math.max(min, Math.min(max, parsed));
    }

    function hashText(value) {
        var text = String(value || '');
        var hash = 2166136261;
        for (var i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    function parseAutoMemorySettingsStorage(value) {
        if (value == null || value === '') return null;
        if (typeof value === 'object' && !Array.isArray(value)) return value;
        try {
            var parsed = JSON.parse(String(value));
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
        } catch (e) {
            return null;
        }
    }

    function getLegacyAutoMemorySettingsForChat(chatId) {
        var normalizedChatId = normalizeAutoMemorySettingsChatId(chatId);
        if (!normalizedChatId) return null;
        var rawState = null;
        try { rawState = JSON.parse(localStorage.getItem(AUTO_MEMORY_STATE_PREFIX + normalizedChatId) || 'null'); } catch (e) {}
        if (!rawState || typeof rawState !== 'object') return null;
        var signature = String(rawState.settingsSignature || '');
        if (!signature && rawState.pendingApply) signature = String(rawState.pendingApply.settingsSignature || '');
        var values = null;
        try { values = JSON.parse(signature); } catch (e) {}
        if (!Array.isArray(values) || values.length < 9) return null;
        return {
            settingsVersion:4,
            settingsUpdatedAt:Math.max(Date.now(), Number(rawState.lastSuccessAt) || 0),
            enabled:!!values[0],
            intervalTurns:values[1],
            readTurns:values[2],
            excludeRecentTurns:values[3],
            contextCards:values[4],
            midMergeTurns:values[5],
            maxCards:values[6],
            compactTarget:values[7],
            protectUserAdded:values[8] !== false
        };
    }

    function readStoredAutoMemorySettings(chatId) {
        var localKey = getAutoMemorySettingsStorageKey(chatId, false);
        var gmKey = getAutoMemorySettingsStorageKey(chatId, true);
        if (!localKey || !gmKey) return {};
        var gmSettings = null;
        if (typeof GM_getValue === 'function') {
            try { gmSettings = parseAutoMemorySettingsStorage(GM_getValue(gmKey, '')); } catch (e) {}
        }
        var localSettings = null;
        try { localSettings = parseAutoMemorySettingsStorage(localStorage.getItem(localKey)); } catch (e) {}

        var gmUpdatedAt = Math.max(0, Number(gmSettings && gmSettings.settingsUpdatedAt) || 0);
        var localUpdatedAt = Math.max(0, Number(localSettings && localSettings.settingsUpdatedAt) || 0);
        var selected = localSettings && (!gmSettings || localUpdatedAt >= gmUpdatedAt) ? localSettings : (gmSettings || localSettings);
        if (!selected) {
            selected = getLegacyAutoMemorySettingsForChat(chatId);
            if (!selected) return {};
            try { writeStoredAutoMemorySettings(chatId, selected); } catch (e) {}
            return selected;
        }

        var serialized = JSON.stringify(selected);
        if (selected === localSettings && typeof GM_setValue === 'function') {
            var gmSerialized = gmSettings ? JSON.stringify(gmSettings) : '';
            if (!gmSettings || localUpdatedAt > gmUpdatedAt || serialized !== gmSerialized) {
                try { GM_setValue(gmKey, serialized); } catch (e) {}
            }
        } else if (selected === gmSettings) {
            try {
                if (!localSettings || localUpdatedAt < gmUpdatedAt) localStorage.setItem(localKey, serialized);
            } catch (e) {}
        }
        return selected;
    }

    function writeStoredAutoMemorySettings(chatId, settings) {
        var localKey = getAutoMemorySettingsStorageKey(chatId, false);
        var gmKey = getAutoMemorySettingsStorageKey(chatId, true);
        if (!localKey || !gmKey) throw new Error('채팅방을 확인할 수 없어 자동 설정을 저장하지 못했습니다.');
        var serialized = JSON.stringify(settings || {});
        var localVerified = false;
        var gmVerified = false;

        try {
            localStorage.setItem(localKey, serialized);
            localVerified = localStorage.getItem(localKey) === serialized;
        } catch (e) {}

        if (typeof GM_setValue === 'function') {
            try {
                GM_setValue(gmKey, serialized);
                if (typeof GM_getValue === 'function') {
                    gmVerified = JSON.stringify(parseAutoMemorySettingsStorage(GM_getValue(gmKey, '')) || {}) === serialized;
                } else {
                    gmVerified = true;
                }
            } catch (e) {}
        }

        if (!localVerified && !gmVerified) throw new Error('자동 장기기억 설정을 브라우저 저장소에 기록하지 못했습니다.');
        return settings;
    }

    function getAutoMemorySettings(chatId) {
        var saved = readStoredAutoMemorySettings(chatId);
        if (!Number.isFinite(Number(saved.settingsVersion)) || Number(saved.settingsVersion) < 2) {
            if (saved.intervalTurns == null || Number(saved.intervalTurns) === 5) saved.intervalTurns = 10;
            if (saved.readTurns == null || Number(saved.readTurns) === 5) saved.readTurns = 10;
            if (saved.midMergeTurns == null) saved.midMergeTurns = 10;
        }
        var settings = Object.assign({}, AUTO_MEMORY_DEFAULTS, saved);
        settings.settingsVersion = 4;
        settings.settingsUpdatedAt = Math.max(0, Number(settings.settingsUpdatedAt) || 0);
        settings.enabled = !!settings.enabled;
        settings.intervalTurns = clampInteger(settings.intervalTurns, 1, 50, AUTO_MEMORY_DEFAULTS.intervalTurns);
        settings.readTurns = clampInteger(settings.readTurns, 1, 50, AUTO_MEMORY_DEFAULTS.readTurns);
        settings.excludeRecentTurns = clampInteger(settings.excludeRecentTurns, 0, 10, AUTO_MEMORY_DEFAULTS.excludeRecentTurns);
        settings.contextCards = clampInteger(settings.contextCards, 3, 5, AUTO_MEMORY_DEFAULTS.contextCards);
        settings.midMergeTurns = clampInteger(settings.midMergeTurns, 0, 500, AUTO_MEMORY_DEFAULTS.midMergeTurns);
        settings.maxCards = clampInteger(settings.maxCards, 5, 20, AUTO_MEMORY_DEFAULTS.maxCards);
        settings.compactTarget = clampInteger(settings.compactTarget, 1, settings.maxCards, Math.min(AUTO_MEMORY_DEFAULTS.compactTarget, settings.maxCards));
        settings.protectUserAdded = settings.protectUserAdded !== false;
        return settings;
    }

    function saveAutoMemorySettings(chatId, settings) {
        chatId = normalizeAutoMemorySettingsChatId(chatId);
        if (!chatId) throw new Error('채팅방을 확인할 수 없어 자동 설정을 저장하지 못했습니다.');
        var normalized = Object.assign({}, AUTO_MEMORY_DEFAULTS, settings || {});
        normalized = getNormalizedAutoMemorySettings(normalized);
        var stored = readStoredAutoMemorySettings(chatId);
        AUTO_MEMORY_SETTINGS_LAST_WRITE_AT = Math.max(Date.now(), AUTO_MEMORY_SETTINGS_LAST_WRITE_AT + 1, (Number(stored.settingsUpdatedAt) || 0) + 1);
        normalized.settingsUpdatedAt = AUTO_MEMORY_SETTINGS_LAST_WRITE_AT;
        writeStoredAutoMemorySettings(chatId, normalized);
        notifyAutoMemoryStatus(chatId);
        if (getChatId() === chatId) setTimeout(function() { refreshAutoMemorySchedule(false); }, 0);
        return normalized;
    }

    function getNormalizedAutoMemorySettings(settings) {
        var source = settings || {};
        var maxCards = clampInteger(source.maxCards, 5, 20, AUTO_MEMORY_DEFAULTS.maxCards);
        return {
            settingsVersion:4,
            settingsUpdatedAt:Math.max(0, Number(source.settingsUpdatedAt) || 0),
            enabled:!!source.enabled,
            intervalTurns:clampInteger(source.intervalTurns, 1, 50, AUTO_MEMORY_DEFAULTS.intervalTurns),
            readTurns:clampInteger(source.readTurns, 1, 50, AUTO_MEMORY_DEFAULTS.readTurns),
            excludeRecentTurns:clampInteger(source.excludeRecentTurns, 0, 10, AUTO_MEMORY_DEFAULTS.excludeRecentTurns),
            contextCards:clampInteger(source.contextCards, 3, 5, AUTO_MEMORY_DEFAULTS.contextCards),
            midMergeTurns:clampInteger(source.midMergeTurns, 0, 500, AUTO_MEMORY_DEFAULTS.midMergeTurns),
            maxCards:maxCards,
            compactTarget:clampInteger(source.compactTarget, 1, maxCards, Math.min(AUTO_MEMORY_DEFAULTS.compactTarget, maxCards)),
            protectUserAdded:source.protectUserAdded !== false
        };
    }

    function getAutoMemorySettingsSignature(settings) {
        var source = getNormalizedAutoMemorySettings(settings || {});
        return JSON.stringify([
            source.enabled,
            source.intervalTurns,
            source.readTurns,
            source.excludeRecentTurns,
            source.contextCards,
            source.midMergeTurns,
            source.maxCards,
            source.compactTarget,
            source.protectUserAdded
        ]);
    }

    function isAutoMemorySettingsSignatureCurrent(signature, chatId) {
        return String(signature || '') === getAutoMemorySettingsSignature(getAutoMemorySettings(chatId));
    }

    function reconcileAutoMemoryStateAfterSettingsChange(chatId, previousSettings, nextSettings) {
        if (getAutoMemorySettingsSignature(previousSettings) === getAutoMemorySettingsSignature(nextSettings)) return false;
        requestAutoMemorySettingsReplan(chatId);
        notifyAutoMemoryStatus(chatId);
        if (!AUTO_MEMORY_BUSY) {
            if (safelyResetAutoMemoryPlanningAfterSettingsSave(chatId, nextSettings)) consumeAutoMemorySettingsReplan(chatId);
            if (getChatId() === chatId) scheduleAutoMemoryResponseCheck(100);
        }
        return true;
    }

    function safelyClearAutoMemoryFailureAfterSettingsSave(chatId) {
        if (!chatId || AUTO_MEMORY_BUSY || !acquireAutoMemoryLock(chatId)) return false;
        try {
            var state = getAutoMemoryState(chatId);
            clearAutoMemoryFailure(state);
            state.lastError = '';
            saveAutoMemoryState(chatId, state);
            return true;
        } finally {
            releaseAutoMemoryLock(chatId);
        }
    }

    function makeAutoMemoryState() {
        return {
            version:2,
            initialized:false,
            lastScheduleTurnKey:'',
            lastProcessedTurnKey:'',
            pendingCutoffTurnKey:'',
            nativeHashes:{},
            managedHashes:{},
            managedCards:{},
            pendingNativeIds:[],
            pendingDeleteIds:[],
            pendingApply:null,
            waitingForSlot:false,
            observedNewTurns:0,
            openTailId:'',
            midSegmentIds:[],
            processedSinceMidMerge:0,
            forceFullCompact:false,
            fullBeforeRoutine:false,
            settingsSignature:'',
            needsV2InventoryMigration:false,
            lastSuccessAt:0,
            lastAutoUsage:null,
            autoUsageCalls:0,
            autoUsageTotalUsd:0,
            lastStatus:'',
            lastError:'',
            consecutiveFailures:0,
            retryAfter:0,
            autoPaused:false
        };
    }

    function getAutoMemoryState(chatId) {
        var state = makeAutoMemoryState();
        if (!chatId) return state;
        var saved = {};
        try {
            saved = JSON.parse(localStorage.getItem(AUTO_MEMORY_STATE_PREFIX + chatId) || '{}') || {};
            state = Object.assign(state, saved);
        } catch (e) {}
        var savedVersion = Number(saved.version) || 0;
        if (Object.keys(saved).length && savedVersion < 2) state.needsV2InventoryMigration = true;
        if (state.pendingApply && state.pendingApply.operationMode == null && state.pendingApply.mutationStarted === false) {
            state.pendingApply = null;
            state.lastStatus = '구버전 미적용 저장 계획 폐기 · 누적형 구조로 재계획 대기';
        }
        if (!state.nativeHashes || typeof state.nativeHashes !== 'object') state.nativeHashes = {};
        if (!state.managedHashes || typeof state.managedHashes !== 'object') state.managedHashes = {};
        if (!state.managedCards || typeof state.managedCards !== 'object') state.managedCards = {};
        if (!Array.isArray(state.pendingNativeIds)) state.pendingNativeIds = [];
        if (!Array.isArray(state.pendingDeleteIds)) state.pendingDeleteIds = [];
        if (!Array.isArray(state.midSegmentIds)) state.midSegmentIds = [];
        state.midSegmentIds = Array.from(new Set(state.midSegmentIds.map(String).filter(Boolean)));
        state.openTailId = String(state.openTailId || '');
        state.processedSinceMidMerge = Math.max(0, Number(state.processedSinceMidMerge) || 0);
        state.forceFullCompact = !!state.forceFullCompact;
        state.fullBeforeRoutine = !!state.fullBeforeRoutine;
        state.settingsSignature = String(state.settingsSignature || '');
        state.needsV2InventoryMigration = !!state.needsV2InventoryMigration;
        state.version = 2;
        if (state.pendingApply != null && typeof state.pendingApply !== 'object') state.pendingApply = { invalid:true };
        state.waitingForSlot = !!state.waitingForSlot;
        state.consecutiveFailures = clampInteger(state.consecutiveFailures, 0, 3, 0);
        state.retryAfter = Number(state.retryAfter) || 0;
        state.autoPaused = !!state.autoPaused;
        if (!state.lastAutoUsage || typeof state.lastAutoUsage !== 'object') state.lastAutoUsage = null;
        state.autoUsageCalls = Math.max(0, Number(state.autoUsageCalls) || 0);
        state.autoUsageTotalUsd = Math.max(0, Number(state.autoUsageTotalUsd) || 0);
        return state;
    }

    function saveAutoMemoryState(chatId, state) {
        if (!chatId) return;
        localStorage.setItem(AUTO_MEMORY_STATE_PREFIX + chatId, JSON.stringify(state));
        notifyAutoMemoryStatus(chatId, state);
    }

    function notifyAutoMemoryStatus(chatId, state) {
        try {
            window.dispatchEvent(new CustomEvent('crack-ext-auto-memory-status', { detail:{ chatId:chatId || getChatId(), state:state || null } }));
        } catch (e) {}
    }

    function resetAutoMemoryState(chatId) {
        if (!chatId) return;
        localStorage.removeItem(AUTO_MEMORY_STATE_PREFIX + chatId);
        notifyAutoMemoryStatus(chatId);
    }

    function acquireAutoMemoryLock(chatId) {
        if (!chatId) return false;
        var key = AUTO_MEMORY_LOCK_PREFIX + chatId;
        var now = Date.now();
        try {
            var current = JSON.parse(localStorage.getItem(key) || 'null');
            if (current && current.owner !== AUTO_MEMORY_SESSION_ID && current.expiresAt > now) return false;
            var next = { owner:AUTO_MEMORY_SESSION_ID, expiresAt:now + AUTO_MEMORY_LOCK_MS };
            localStorage.setItem(key, JSON.stringify(next));
            var confirmed = JSON.parse(localStorage.getItem(key) || 'null');
            return !!confirmed && confirmed.owner === AUTO_MEMORY_SESSION_ID;
        } catch (e) {
            return false;
        }
    }

    function releaseAutoMemoryLock(chatId) {
        if (!chatId) return;
        var key = AUTO_MEMORY_LOCK_PREFIX + chatId;
        try {
            var current = JSON.parse(localStorage.getItem(key) || 'null');
            if (current && current.owner === AUTO_MEMORY_SESSION_ID) localStorage.removeItem(key);
        } catch (e) {}
    }

    function renewAutoMemoryLock(chatId) {
        if (!chatId) return false;
        var key = AUTO_MEMORY_LOCK_PREFIX + chatId;
        try {
            var current = JSON.parse(localStorage.getItem(key) || 'null');
            if (!current || current.owner !== AUTO_MEMORY_SESSION_ID) return false;
            current.expiresAt = Date.now() + AUTO_MEMORY_LOCK_MS;
            localStorage.setItem(key, JSON.stringify(current));
            var confirmed = JSON.parse(localStorage.getItem(key) || 'null');
            return !!confirmed && confirmed.owner === AUTO_MEMORY_SESSION_ID;
        } catch (e) {
            return false;
        }
    }

    function getToken() {
        const m = document.cookie.match(/(^| )access_token=([^;]+)/);
        return m ? m[2] : null;
    }

    function escapeHtml(s) {
        if (!s) return "";
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    function apiCall(method, path, body, options) {
        options = options || {};
        const token = getToken(), chatId = String(options.chatId || getChatId() || '');
        if (!token || !chatId) {
            if (options.strict) return Promise.reject(new Error('인증 정보 또는 채팅 ID를 찾을 수 없습니다.'));
            if (!options.silent) showUiAlert('인증 정보 또는 채팅 ID를 찾을 수 없습니다.', '연결 정보 없음', { tone:'warning' });
            return Promise.resolve(null);
        }
        const opts = {
            method,
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            }
        };
        if (body) opts.body = JSON.stringify(body);
        return fetch(API_BASE + '/' + chatId + path, opts)
            .then(r => {
                if (!r.ok) return r.text().then(t => {
                    console.error('API Error:', r.status, t);
                    if (options.strict) throw new Error('Crack API ' + r.status + ': ' + (t || '요청 실패'));
                    return null;
                });
                return r.text().then(t => {
                    if (!t) return { result:'SUCCESS' };
                    try { return JSON.parse(t); }
                    catch (e) {
                        if (options.strict) throw new Error('Crack API 응답 JSON을 읽지 못했습니다.');
                        console.error('API JSON Error:', e);
                        return null;
                    }
                });
            })
            .catch(e => {
                if (options.strict) throw e;
                if (!options.silent) showUiAlert('네트워크 오류: ' + e.message, '네트워크 오류', { tone:'danger' });
                else console.warn('[AutoMemory] network error:', e);
                return null;
            });
    }

async function fetchSummaries(options) {
    options = options || {};
    let allSummaries = [];
    let cursor = null;
    let seenCursors = new Set();
    while (true) {
        let path = '/summaries?limit=20&type=longTerm&orderBy=newest&filter=all';
        if (cursor) path += '&cursor=' + encodeURIComponent(cursor);
        let res = await apiCall('GET', path, null, options);
        if (!res || !res.data || !Array.isArray(res.data.summaries)) {
            if (options.strict) throw new Error('장기기억 목록 응답 형식이 올바르지 않습니다.');
            break;
        }
        if (res.data.summaries.length === 0) {
            if (options.strict && res.data.nextCursor) throw new Error('장기기억 페이지 응답이 불완전합니다.');
            break;
        }
        allSummaries = allSummaries.concat(res.data.summaries);
        if (res.data.nextCursor) {
            cursor = String(res.data.nextCursor);
            if (seenCursors.has(cursor)) {
                if (options.strict) throw new Error('장기기억 페이지 커서가 반복되었습니다.');
                break;
            }
            seenCursors.add(cursor);
        } else {
            break;
        }
    }
    return allSummaries;
}

async function fetchRecentMessageObjects(limit, options) {
    options = options || {};
    let allMessages = [];
    let cursor = null;
    let seenCursors = new Set();
    let requestedLimit = parseInt(limit, 10);
    if (isNaN(requestedLimit)) requestedLimit = 15;
    const isUnlimited = requestedLimit === 0;
    const stopKeys = new Set((options.stopKeys || []).map(String).filter(Boolean));
    const hasStopKeys = stopKeys.size > 0;
    let stopKeysSatisfied = false;
    while (true) {
        let fetchLimit = isUnlimited ? 50 : Math.min(requestedLimit - allMessages.length, 50);
        let path = '/messages?limit=' + fetchLimit;
        if (cursor) path += '&cursor=' + encodeURIComponent(cursor);
        let res = await apiCall('GET', path, null, options);
        if (!res || !res.data || !Array.isArray(res.data.messages)) {
            if (options.strict) throw new Error('대화 로그 응답 형식이 올바르지 않습니다.');
            break;
        }
        if (res.data.messages.length === 0) {
            if (options.strict && res.data.nextCursor) throw new Error('대화 로그 페이지 응답이 불완전합니다.');
            break;
        }
        allMessages = allMessages.concat(res.data.messages);
        if (stopKeys.size) {
            res.data.messages.forEach(function(message) {
                var stableId = getMessageStableId(message);
                if (stableId) stopKeys.delete(stableId);
                if (message && message.turnId) stopKeys.delete(String(message.turnId));
            });
        }
        if (!isUnlimited && allMessages.length >= requestedLimit) break;
        if (isUnlimited && hasStopKeys && !stopKeys.size) {
            if (stopKeysSatisfied || !res.data.nextCursor) break;
            stopKeysSatisfied = true;
        }
        if (res.data.nextCursor) {
            cursor = String(res.data.nextCursor);
            if (seenCursors.has(cursor)) {
                if (options.strict) throw new Error('대화 로그 페이지 커서가 반복되었습니다.');
                break;
            }
            seenCursors.add(cursor);
        } else {
            break;
        }
    }
    if (!isUnlimited) allMessages = allMessages.slice(0, requestedLimit);
    return allMessages.reverse();
}

async function fetchRecentMessages(limit) {
    let msgs = await fetchRecentMessageObjects(limit);
    if (!msgs || msgs.length === 0) return null;
    return msgs.map(m => (m.role === 'user' ? 'User' : 'Character') + ': ' + m.content).join('\n\n');
}


    function buildSystemPrompt(userPrompt) {
        return userPrompt || '';
    }

    function stripCodeFence(value) {
        var text = String(value || '').replace(/\r\n?/g, '\n').trim();
        text = text.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '').trim();
        return text;
    }

    function parseGeneratedMemoryCards(value) {
        var text = stripCodeFence(value);
        if (!text) return [];
        var lines = text.split('\n');
        var cards = [];
        var current = null;
        var titleLine = /^\s*\[([^\]\r\n]+)\]\s*(.*)$/;

        function pushCurrent() {
            if (!current) return;
            var body = current.bodyLines.join('\n').replace(/^\n+|\n+$/g, '').trimEnd();
            cards.push({ title:current.title.trim(), summary:body, inline:current.inline });
        }

        lines.forEach(function(line) {
            var match = line.match(titleLine);
            if (match) {
                pushCurrent();
                current = { title:match[1], bodyLines:[], inline:!!(match[2] && match[2].trim()) };
                if (match[2] && match[2].trim()) current.bodyLines.push(match[2].replace(/^\s+/, ''));
            } else if (current) {
                current.bodyLines.push(line);
            }
        });
        pushCurrent();
        return cards;
    }

    async function finalizeGeneratedMemoryResult(provider, config, rawText, isCompress) {
        // AI가 생성한 슬롯 수·병합·분리·본문 형식을 수정하지 않습니다.
        // 저장 한도 초과 여부는 미리보기와 저장 시점에만 사용자에게 안내합니다.
        return {
            text:stripCodeFence(rawText),
            repaired:false,
            repairMode:'none',
            issues:[]
        };
    }

    function extractOpenAIText(data) {
        if (!data) return '';
        if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
        var parts = [];
        (data.output || []).forEach(function(item) {
            (item.content || []).forEach(function(content) {
                if (content && content.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
            });
        });
        return parts.join('\n').trim();
    }

    async function readApiError(response, fallback) {
        try {
            var raw = await response.text();
            if (!raw) return fallback;
            try {
                var data = JSON.parse(raw);
                return data && data.error && data.error.message ? data.error.message : raw;
            } catch (e) {
                return raw;
            }
        } catch (ignored) {
            return fallback;
        }
    }

    // ============== Vertex AI (서비스 계정 JSON) ==============
    var VERTEX_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
    var VERTEX_TOKEN_CACHE = new Map();

    function getPrivilegedRequest() {
        if (typeof GM_xmlhttpRequest === 'function') return GM_xmlhttpRequest;
        return null;
    }

    function isAllowedVertexRequestUrl(url) {
        try {
            var parsed = new URL(url);
            if (parsed.protocol !== 'https:') return false;
            if (parsed.href === VERTEX_OAUTH_TOKEN_URL) return true;
            return parsed.hostname === 'aiplatform.googleapis.com' ||
                /^[a-z0-9-]+-aiplatform\.googleapis\.com$/.test(parsed.hostname);
        } catch (e) {
            return false;
        }
    }

    function vertexHttpRequest(url, options) {
        options = options || {};
        if (!isAllowedVertexRequestUrl(url)) return Promise.reject(new Error('허용되지 않은 Vertex 요청 주소입니다.'));
        var privilegedRequest = getPrivilegedRequest();
        if (!privilegedRequest) return Promise.reject(new Error('GM_xmlhttpRequest를 사용할 수 없어 Vertex 연결을 중단했습니다.'));
        return new Promise(function(resolve, reject) {
            privilegedRequest({
                method:options.method || 'GET',
                url:url,
                headers:options.headers || {},
                data:options.body || null,
                responseType:'text',
                timeout:options.timeout || 90000,
                anonymous:true,
                nocache:true,
                redirect:'error',
                onload:function(result) {
                    if (!isAllowedVertexRequestUrl(result.finalUrl || url)) {
                        reject(new Error('Vertex 요청이 허용되지 않은 주소로 이동했습니다.'));
                        return;
                    }
                    resolve({
                        ok:result.status >= 200 && result.status < 300,
                        status:result.status,
                        text:function() { return Promise.resolve(String(result.responseText || '')); },
                        json:function() { return Promise.resolve(JSON.parse(String(result.responseText || ''))); }
                    });
                },
                onerror:function() { reject(new Error('Vertex 네트워크 오류')); },
                ontimeout:function() { reject(new Error('Vertex 요청 시간 초과')); },
                onabort:function() { reject(new Error('Vertex 요청이 취소되었습니다.')); }
            });
        });
    }

    function parseVertexServiceAccount(jsonText) {
        var parsed;
        try {
            parsed = JSON.parse(String(jsonText || '').trim());
        } catch (e) {
            throw new Error('Vertex 서비스 계정 JSON을 해석할 수 없습니다.');
        }
        if (!parsed || parsed.type !== 'service_account') {
            throw new Error('Vertex JSON의 type이 service_account가 아닙니다.');
        }
        if (!parsed.client_email || !parsed.private_key) {
            throw new Error('Vertex JSON에 client_email 또는 private_key가 없습니다.');
        }
        if (!/-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/.test(parsed.private_key)) {
            throw new Error('Vertex JSON의 private_key 형식이 올바르지 않습니다.');
        }
        if (parsed.token_uri && parsed.token_uri !== VERTEX_OAUTH_TOKEN_URL) {
            throw new Error('Vertex JSON의 token_uri가 Google OAuth 주소와 다릅니다.');
        }
        return {
            projectId:String(parsed.project_id || '').trim(),
            clientEmail:String(parsed.client_email).trim(),
            privateKey:String(parsed.private_key),
            privateKeyId:String(parsed.private_key_id || '').trim()
        };
    }

    // Some Firefox userscript sandboxes forbid numeric access to TypedArrays
    // that cross an Xray boundary. Keep Vertex JWT byte work on plain strings,
    // then use ArrayBuffer + DataView from the same realm as WebCrypto. Unlike a
    // TypedArray, DataView does not trigger Firefox's cross-realm index guard.
    function vertexUtf8Binary(value) {
        var text = String(value == null ? '' : value);
        var output = [];
        for (var i = 0; i < text.length; i++) {
            var codePoint = text.charCodeAt(i);
            if (codePoint >= 0xD800 && codePoint <= 0xDBFF) {
                var next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
                if (next >= 0xDC00 && next <= 0xDFFF) {
                    codePoint = 0x10000 + ((codePoint - 0xD800) << 10) + (next - 0xDC00);
                    i++;
                } else {
                    codePoint = 0xFFFD;
                }
            } else if (codePoint >= 0xDC00 && codePoint <= 0xDFFF) {
                codePoint = 0xFFFD;
            }

            if (codePoint < 0x80) {
                output.push(String.fromCharCode(codePoint));
            } else if (codePoint < 0x800) {
                output.push(String.fromCharCode(
                    0xC0 | (codePoint >> 6),
                    0x80 | (codePoint & 0x3F)
                ));
            } else if (codePoint < 0x10000) {
                output.push(String.fromCharCode(
                    0xE0 | (codePoint >> 12),
                    0x80 | ((codePoint >> 6) & 0x3F),
                    0x80 | (codePoint & 0x3F)
                ));
            } else {
                output.push(String.fromCharCode(
                    0xF0 | (codePoint >> 18),
                    0x80 | ((codePoint >> 12) & 0x3F),
                    0x80 | ((codePoint >> 6) & 0x3F),
                    0x80 | (codePoint & 0x3F)
                ));
            }
        }
        return output.join('');
    }

    function vertexBase64UrlFromBinary(binary) {
        return btoa(String(binary || ''))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/g, '');
    }

    function vertexBase64UrlText(value) {
        return vertexBase64UrlFromBinary(vertexUtf8Binary(value));
    }

    function getVertexCryptoRealm() {
        var realm = null;
        try {
            realm = document && document.defaultView ? document.defaultView : null;
        } catch (e) {}
        if (!realm) realm = window;
        if (!realm || !realm.crypto || !realm.crypto.subtle
            || typeof realm.ArrayBuffer !== 'function'
            || typeof realm.DataView !== 'function') {
            throw new Error('이 브라우저에서는 Vertex JWT 서명을 지원하지 않습니다.');
        }
        return realm;
    }

    function vertexBinaryToCryptoMaterial(binary, realm) {
        var source = String(binary || '');
        var buffer = new realm.ArrayBuffer(source.length);
        var view = new realm.DataView(buffer);
        for (var i = 0; i < source.length; i++) {
            view.setUint8(i, source.charCodeAt(i) & 0xFF);
        }
        return { buffer:buffer, view:view };
    }

    function vertexCryptoBufferBase64Url(buffer, realm) {
        var view = new realm.DataView(buffer);
        var binary = '';
        for (var i = 0; i < view.byteLength; i++) {
            binary += String.fromCharCode(view.getUint8(i));
        }
        return vertexBase64UrlFromBinary(binary);
    }

    function vertexWipeCryptoMaterial(material) {
        if (!material || !material.view) return;
        try {
            for (var i = 0; i < material.view.byteLength; i++) {
                material.view.setUint8(i, 0);
            }
        } catch (e) {}
    }

    function vertexPemToCryptoMaterial(pem, realm) {
        var base64 = String(pem || '')
            .replace(/-----BEGIN PRIVATE KEY-----/g, '')
            .replace(/-----END PRIVATE KEY-----/g, '')
            .replace(/[\r\n\s]/g, '');
        if (!base64) throw new Error('Vertex private_key가 비어 있습니다.');
        var binary = atob(base64);
        return vertexBinaryToCryptoMaterial(binary, realm);
    }

    function isVertexXrayError(error) {
        return /TypedArray data over Xrays|Xray|cloneInto/i.test(String(error && error.message || error || ''));
    }

    function getVertexTokenCacheKey(serviceAccount) {
        return serviceAccount.clientEmail + '|' + (serviceAccount.privateKeyId || 'default');
    }

    function clearVertexAccessToken(serviceAccount) {
        VERTEX_TOKEN_CACHE.delete(getVertexTokenCacheKey(serviceAccount));
    }

    async function getVertexAccessToken(serviceAccount, forceRefresh) {
        var cacheKey = getVertexTokenCacheKey(serviceAccount);
        var cached = VERTEX_TOKEN_CACHE.get(cacheKey);
        var now = Math.floor(Date.now() / 1000);
        if (!forceRefresh && cached && cached.token && cached.expiry > now + 60) return cached.token;

        var cryptoRealm = getVertexCryptoRealm();
        var subtle = cryptoRealm.crypto.subtle;

        var issuedAt = now - 30;
        var jwtHeader = { alg:'RS256', typ:'JWT' };
        if (serviceAccount.privateKeyId) jwtHeader.kid = serviceAccount.privateKeyId;
        var jwtClaims = {
            iss:serviceAccount.clientEmail,
            scope:'https://www.googleapis.com/auth/cloud-platform',
            aud:VERTEX_OAUTH_TOKEN_URL,
            iat:issuedAt,
            exp:issuedAt + 3600
        };
        var signingInput = vertexBase64UrlText(JSON.stringify(jwtHeader)) + '.' + vertexBase64UrlText(JSON.stringify(jwtClaims));
        var cryptoKey;
        var privateKeyMaterial;
        try {
            privateKeyMaterial = vertexPemToCryptoMaterial(serviceAccount.privateKey, cryptoRealm);
            cryptoKey = await subtle.importKey(
                'pkcs8',
                privateKeyMaterial.buffer,
                { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' },
                false,
                ['sign']
            );
        } catch (e) {
            if (isVertexXrayError(e)) {
                throw new Error('Firefox 격리 영역에서 Vertex 개인키를 WebCrypto에 전달하지 못했습니다. Firefox 또는 유저스크립트 관리자를 업데이트해주세요.');
            }
            throw new Error('Vertex private_key를 불러오지 못했습니다. JSON 키 파일을 확인해주세요.');
        } finally {
            vertexWipeCryptoMaterial(privateKeyMaterial);
            privateKeyMaterial = null;
        }
        var signingMaterial;
        var signature;
        try {
            signingMaterial = vertexBinaryToCryptoMaterial(vertexUtf8Binary(signingInput), cryptoRealm);
            signature = await subtle.sign(
                'RSASSA-PKCS1-v1_5',
                cryptoKey,
                signingMaterial.buffer
            );
        } catch (e) {
            if (isVertexXrayError(e)) {
                throw new Error('Firefox 격리 영역에서 Vertex JWT 서명을 처리하지 못했습니다. Firefox 또는 유저스크립트 관리자를 업데이트해주세요.');
            }
            throw e;
        } finally {
            vertexWipeCryptoMaterial(signingMaterial);
            signingMaterial = null;
        }
        var signaturePart;
        try {
            signaturePart = vertexCryptoBufferBase64Url(signature, cryptoRealm);
        } catch (e) {
            if (isVertexXrayError(e)) {
                throw new Error('Firefox 격리 영역에서 Vertex JWT 서명 결과를 읽지 못했습니다. Firefox 또는 유저스크립트 관리자를 업데이트해주세요.');
            }
            throw e;
        }
        if (!signaturePart) throw new Error('Vertex JWT 서명 결과가 비어 있습니다.');
        var assertion = signingInput + '.' + signaturePart;
        // Keep the OAuth body primitive-only as well; this avoids handing a
        // sandbox object record to a page-realm URLSearchParams constructor.
        var formBody = 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')
            + '&assertion=' + encodeURIComponent(assertion);
        var response = await vertexHttpRequest(VERTEX_OAUTH_TOKEN_URL, {
            method:'POST',
            headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
            body:formBody,
            timeout:30000
        });
        if (!response.ok) {
            var oauthError = await response.text();
            try {
                var oauthData = JSON.parse(oauthError);
                oauthError = oauthData.error_description || oauthData.error || '';
            } catch (e) {}
            throw new Error('Vertex OAuth 토큰 교환 실패 (' + response.status + ')' + (oauthError ? ': ' + oauthError.slice(0, 300) : ''));
        }
        var tokenData = await response.json();
        if (!tokenData || !tokenData.access_token) throw new Error('Vertex OAuth 응답에 access_token이 없습니다.');
        if (tokenData.token_type && String(tokenData.token_type).toLowerCase() !== 'bearer') {
            throw new Error('Vertex OAuth 응답의 token_type이 Bearer가 아닙니다.');
        }
        var expiresIn = Math.min(3600, Math.max(60, Number(tokenData.expires_in) || 3600));
        VERTEX_TOKEN_CACHE.set(cacheKey, { token:tokenData.access_token, expiry:now + expiresIn });
        return tokenData.access_token;
    }

    function resolveVertexEndpoint(locationValue, projectIdValue, modelValue) {
        var locationId = String(locationValue || 'global').trim().toLowerCase() || 'global';
        var projectId = String(projectIdValue || '').trim();
        var modelId = String(modelValue || '').trim();
        if (!/^[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(locationId)) {
            throw new Error('Vertex Location 형식이 올바르지 않습니다. 예: global, us-central1');
        }
        if (!projectId) throw new Error('Vertex project_id가 없습니다. JSON 또는 Project ID 칸을 확인해주세요.');
        if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(projectId)) {
            throw new Error('Vertex Project ID 형식이 올바르지 않습니다.');
        }
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(modelId)) {
            throw new Error('Vertex 모델 ID 형식이 올바르지 않습니다.');
        }
        if (modelId.toLowerCase().startsWith('gemini-3') || modelId.toLowerCase().includes('gemini-2.0-flash-thinking')) {
            locationId = 'global';
        }
        var host = locationId === 'global' ? 'aiplatform.googleapis.com' : locationId + '-aiplatform.googleapis.com';
        if (host !== 'aiplatform.googleapis.com' && !/^[a-z0-9-]+-aiplatform\.googleapis\.com$/.test(host)) {
            throw new Error('허용되지 않은 Vertex 호스트입니다.');
        }
        return {
            location:locationId,
            url:'https://' + host + '/v1/projects/' + encodeURIComponent(projectId) +
                '/locations/' + encodeURIComponent(locationId) +
                '/publishers/google/models/' + encodeURIComponent(modelId) + ':generateContent'
        };
    }

    function extractGeminiResponseText(data) {
        var candidates = data && Array.isArray(data.candidates) ? data.candidates : [];
        for (var i = 0; i < candidates.length; i++) {
            var parts = candidates[i] && candidates[i].content && Array.isArray(candidates[i].content.parts)
                ? candidates[i].content.parts : [];
            var text = parts.filter(function(part) { return part && !part.thought; })
                .map(function(part) { return typeof part.text === 'string' ? part.text : ''; }).join('');
            if (text.trim()) return text;
        }
        return '';
    }

    function setGeminiUsage(provider, model, reasoningValue, usage) {
        usage = usage || {};
        setLastAiUsage(provider, model, reasoningValue, {
            inputTokens:usage.promptTokenCount,
            visibleOutputTokens:usage.candidatesTokenCount,
            reasoningTokens:usage.thoughtsTokenCount,
            outputTokens:(finiteNumber(usage.candidatesTokenCount) || 0) + (finiteNumber(usage.thoughtsTokenCount) || 0),
            billableOutputTokens:(finiteNumber(usage.candidatesTokenCount) || 0) + (finiteNumber(usage.thoughtsTokenCount) || 0),
            totalTokens:usage.totalTokenCount,
            cachedInputTokens:usage.cachedContentTokenCount
        });
    }

    var LAST_AI_USAGE = null;
    var MODEL_PRICING_UPDATED_AT = '2026-07-21';
    var USD_KRW_FALLBACK = 1400;
    var USD_KRW_CACHE_KEY = 'crack_ext_usd_krw_rate_v1';
    var USD_KRW_CACHE_TTL = 12 * 60 * 60 * 1000;

    // 유료 API 표준 처리 기준, USD / 1M tokens. 실제 청구액은 무료 티어·캐시·지역·세금에 따라 달라질 수 있음.
    var MODEL_PRICING_USD_PER_M = {
        google: {
            'gemini-3.6-flash': { input:1.50, cachedInput:0.15, output:7.50 },
            'gemini-3.5-flash': { input:1.50, cachedInput:0.15, output:9.00 },
            'gemini-3.1-pro-preview': { input:2.00, cachedInput:0.20, output:12.00, longInput:4.00, longCachedInput:0.40, longOutput:18.00, threshold:200000 },
            'gemini-3.1-flash-lite': { input:0.25, cachedInput:0.025, output:1.50 },
            'gemini-3-pro-preview': { input:2.00, cachedInput:0.20, output:12.00, longInput:4.00, longCachedInput:0.40, longOutput:18.00, threshold:200000, estimated:true },
            'gemini-3-flash-preview': { input:0.50, cachedInput:0.05, output:3.00 },
            'gemini-2.5-pro': { input:1.25, cachedInput:0.125, output:10.00, longInput:2.50, longCachedInput:0.25, longOutput:15.00, threshold:200000 },
            'gemini-2.5-flash': { input:0.30, cachedInput:0.03, output:2.50 },
            'gemini-2.5-flash-lite': { input:0.10, cachedInput:0.01, output:0.40 }
        },
        deepseek: {
            'deepseek-v4-flash': { input:0.14, cachedInput:0.0028, output:0.28 },
            'deepseek-v4-pro': { input:0.435, cachedInput:0.003625, output:0.87 }
        },
        openai: {
            'gpt-5.6-sol': { input:5.00, cachedInput:0.50, output:30.00 },
            'gpt-5.6-terra': { input:2.50, cachedInput:0.25, output:15.00 },
            'gpt-5.6-luna': { input:1.00, cachedInput:0.10, output:6.00 },
            'gpt-5.6': { input:1.00, cachedInput:0.10, output:6.00, estimated:true },
            'gpt-5.4': { input:2.50, cachedInput:0.25, output:15.00 },
            'gpt-5.4-mini': { input:0.75, cachedInput:0.075, output:4.50 },
            'gpt-4.1': { input:2.00, cachedInput:0.50, output:8.00 },
            'gpt-4.1-mini': { input:0.40, cachedInput:0.10, output:1.60 }
        }
    };

    function finiteNumber(value) {
        var n = Number(value);
        return Number.isFinite(n) && n >= 0 ? n : null;
    }

    function getReasoningStorageKey(provider, model) {
        return 'crack_ext_reasoning_' + provider + '_' + String(model || 'default').replace(/[^a-zA-Z0-9_.-]/g, '_');
    }

    function getReasoningOptions(provider, model) {
        var auto = [{ v:'auto', t:'자동' }];
        if (provider === 'deepseek') {
            return auto.concat([
                { v:'off', t:'끔' },
                { v:'high', t:'High' },
                { v:'max', t:'Max' }
            ]);
        }
        if (provider === 'openai') {
            var openAiModel = String(model || '').toLowerCase();
            if (!openAiModel.startsWith('gpt-5')) return auto;
            if (openAiModel === 'gpt-5-pro' || openAiModel.includes('-pro-')) {
                return auto.concat([{ v:'high', t:'높음 · 고정' }]);
            }
            if (openAiModel.startsWith('gpt-5.1')) {
                return auto.concat([
                    { v:'none', t:'없음' },
                    { v:'low', t:'낮음' },
                    { v:'medium', t:'보통' },
                    { v:'high', t:'높음' }
                ]);
            }
            return auto.concat([
                { v:'none', t:'없음' },
                { v:'minimal', t:'최소' },
                { v:'low', t:'낮음' },
                { v:'medium', t:'보통' },
                { v:'high', t:'높음' },
                { v:'xhigh', t:'최대' }
            ]);
        }
        if (provider === 'google' || provider === 'firebase' || provider === 'vertex') {
            var m = String(model || '').toLowerCase();
            if (m.includes('2.5-pro')) {
                return auto.concat([
                    { v:'low', t:'낮음 · 1,024' },
                    { v:'medium', t:'보통 · 8,192' },
                    { v:'high', t:'높음 · 16,384' },
                    { v:'max', t:'최대 · 32,768' }
                ]);
            }
            if (m.includes('2.5-flash-lite')) {
                return auto.concat([
                    { v:'off', t:'끔 · 0' },
                    { v:'low', t:'낮음 · 512' },
                    { v:'medium', t:'보통 · 2,048' },
                    { v:'high', t:'높음 · 8,192' },
                    { v:'max', t:'최대 · 24,576' }
                ]);
            }
            if (m.includes('2.5-flash')) {
                return auto.concat([
                    { v:'off', t:'끔 · 0' },
                    { v:'low', t:'낮음 · 1,024' },
                    { v:'medium', t:'보통 · 4,096' },
                    { v:'high', t:'높음 · 8,192' },
                    { v:'max', t:'최대 · 24,576' }
                ]);
            }
            if (m.includes('3.1-pro')) {
                return auto.concat([
                    { v:'low', t:'낮음' },
                    { v:'medium', t:'보통' },
                    { v:'high', t:'높음' }
                ]);
            }
            if (m.includes('3-pro')) {
                return auto.concat([
                    { v:'low', t:'낮음' },
                    { v:'high', t:'높음' }
                ]);
            }
            return auto.concat([
                { v:'minimal', t:'최소' },
                { v:'low', t:'낮음' },
                { v:'medium', t:'보통' },
                { v:'high', t:'높음' }
            ]);
        }
        return auto;
    }

    function getReasoningOptionLabel(provider, model, value) {
        var option = getReasoningOptions(provider, model).find(function(item) { return item.v === value; });
        return option ? option.t : (value || '자동');
    }

    function updateReasoningOptions(provider, model) {
        var select = document.getElementById('ce-ai-reasoning');
        if (!select) return;
        var options = getReasoningOptions(provider, model);
        var key = getReasoningStorageKey(provider, model);
        var saved = localStorage.getItem(key) || 'auto';
        if (!options.some(function(item) { return item.v === saved; })) saved = 'auto';
        select.innerHTML = '';
        options.forEach(function(item) {
            var option = document.createElement('option');
            option.value = item.v;
            option.textContent = item.t;
            if (item.v === saved) option.selected = true;
            select.appendChild(option);
        });
        select.disabled = options.length <= 1;
        select.title = options.length <= 1 ? '이 모델은 별도 추론 조절값을 지원하지 않습니다.' : '모델별 추론 강도';
    }

    function geminiThinkingBudget(model, value) {
        var m = String(model || '').toLowerCase();
        if (value === 'auto') return null;
        if (value === 'off') return 0;
        if (m.includes('2.5-pro')) return { low:1024, medium:8192, high:16384, max:32768 }[value] || null;
        if (m.includes('2.5-flash-lite')) return { low:512, medium:2048, high:8192, max:24576 }[value] || null;
        return { low:1024, medium:4096, high:8192, max:24576 }[value] || null;
    }

    function getGeminiThinkingConfig(model, value) {
        if (!value || value === 'auto') return null;
        var m = String(model || '').toLowerCase();
        if (m.includes('2.5-')) {
            var budget = geminiThinkingBudget(model, value);
            return budget == null ? null : { thinkingBudget:budget };
        }
        if (value === 'off' || value === 'none' || value === 'max' || value === 'xhigh') return null;
        return { thinkingLevel:value };
    }

    function getGeminiGenerationConfig(model) {
        var m = String(model || '').toLowerCase();
        // Gemini 3 계열은 모델별 고정/권장 샘플링 설정과 충돌하지 않도록 별도 값을 보내지 않는다.
        if (m.startsWith('gemini-3')) return {};
        return { temperature:0.2, topK:40, topP:0.8 };
    }

    function getCachedUsdKrwRate() {
        try {
            var saved = JSON.parse(localStorage.getItem(USD_KRW_CACHE_KEY) || 'null');
            if (saved && finiteNumber(saved.rate) && saved.rate > 500) {
                return { rate:Number(saved.rate), updatedAt:Number(saved.updatedAt) || 0, source:saved.source || 'cache', fallback:false };
            }
        } catch (e) {}
        return { rate:USD_KRW_FALLBACK, updatedAt:0, source:'fallback', fallback:true };
    }

    async function fetchJsonWithTimeout(url, timeoutMs) {
        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timer = controller ? setTimeout(function() { controller.abort(); }, timeoutMs || 2500) : null;
        try {
            var response = await fetch(url, controller ? { signal:controller.signal } : {});
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return await response.json();
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    async function refreshUsdKrwRate(force) {
        var cached = getCachedUsdKrwRate();
        if (!force && !cached.fallback && Date.now() - cached.updatedAt < USD_KRW_CACHE_TTL) return cached;
        var attempts = [
            {
                url:'https://api.frankfurter.app/latest?from=USD&to=KRW',
                parse:function(data) { return data && data.rates ? finiteNumber(data.rates.KRW) : null; },
                source:'Frankfurter'
            },
            {
                url:'https://open.er-api.com/v6/latest/USD',
                parse:function(data) { return data && data.rates ? finiteNumber(data.rates.KRW) : null; },
                source:'ExchangeRate-API'
            },
            {
                url:'https://api.exchangerate-api.com/v4/latest/USD',
                parse:function(data) { return data && data.rates ? finiteNumber(data.rates.KRW) : null; },
                source:'ExchangeRate-API'
            }
        ];
        for (var i = 0; i < attempts.length; i++) {
            try {
                var data = await fetchJsonWithTimeout(attempts[i].url, 2800);
                var rate = attempts[i].parse(data);
                if (rate && rate > 500) {
                    var fresh = { rate:rate, updatedAt:Date.now(), source:attempts[i].source, fallback:false };
                    localStorage.setItem(USD_KRW_CACHE_KEY, JSON.stringify(fresh));
                    if (LAST_AI_USAGE) {
                        LAST_AI_USAGE.usdKrwRate = rate;
                        LAST_AI_USAGE.fxFallback = false;
                        LAST_AI_USAGE.fxSource = attempts[i].source;
                        updateVisibleAiUsage();
                    }
                    return fresh;
                }
            } catch (e) {}
        }
        return cached;
    }

    function getModelPricing(provider, model, inputTokens) {
        var catalogProvider = (provider === 'firebase' || provider === 'vertex') ? 'google' : provider;
        var catalog = MODEL_PRICING_USD_PER_M[catalogProvider] || {};
        var price = catalog[String(model || '').toLowerCase()] || null;
        if (!price) return null;
        var useLong = price.threshold && Number(inputTokens || 0) > price.threshold;
        return {
            input:useLong && price.longInput != null ? price.longInput : price.input,
            cachedInput:useLong && price.longCachedInput != null ? price.longCachedInput : price.cachedInput,
            output:useLong && price.longOutput != null ? price.longOutput : price.output,
            estimated:!!price.estimated || provider === 'vertex',
            longContext:!!useLong
        };
    }

    function calculateUsageCost(meta) {
        if (!meta) return null;
        var input = finiteNumber(meta.inputTokens);
        var output = finiteNumber(meta.billableOutputTokens);
        if (output == null) output = finiteNumber(meta.outputTokens);
        if (input == null || output == null) return null;
        var cached = Math.min(finiteNumber(meta.cachedInputTokens) || 0, input);
        var uncached = Math.max(0, input - cached);
        var pricing = getModelPricing(meta.provider, meta.model, input);
        if (!pricing) return null;
        var usd = ((uncached * pricing.input) + (cached * (pricing.cachedInput != null ? pricing.cachedInput : pricing.input)) + (output * pricing.output)) / 1000000;
        return { usd:usd, pricing:pricing };
    }

    function setLastAiUsage(provider, model, requested, usageData) {
        usageData = usageData || {};
        var reasoningTokens = finiteNumber(usageData.reasoningTokens);
        var outputTokens = finiteNumber(usageData.outputTokens);
        var visibleOutputTokens = finiteNumber(usageData.visibleOutputTokens);
        if (visibleOutputTokens == null && outputTokens != null) visibleOutputTokens = Math.max(0, outputTokens - (reasoningTokens || 0));
        var fx = getCachedUsdKrwRate();
        LAST_AI_USAGE = {
            provider:provider,
            model:model,
            requested:requested || 'auto',
            requestedLabel:getReasoningOptionLabel(provider, model, requested || 'auto'),
            inputTokens:finiteNumber(usageData.inputTokens),
            outputTokens:outputTokens,
            visibleOutputTokens:visibleOutputTokens,
            billableOutputTokens:finiteNumber(usageData.billableOutputTokens) != null ? finiteNumber(usageData.billableOutputTokens) : outputTokens,
            reasoningTokens:reasoningTokens,
            totalTokens:finiteNumber(usageData.totalTokens),
            cachedInputTokens:finiteNumber(usageData.cachedInputTokens),
            usdKrwRate:fx.rate,
            fxFallback:fx.fallback,
            fxSource:fx.source
        };
        var cost = calculateUsageCost(LAST_AI_USAGE);
        LAST_AI_USAGE.costUsd = cost ? cost.usd : null;
        LAST_AI_USAGE.pricingEstimated = cost ? cost.pricing.estimated : false;
        LAST_AI_USAGE.longContextPricing = cost ? cost.pricing.longContext : false;
        updateVisibleAiUsage();
        refreshUsdKrwRate(false);
    }

    function formatUsd(value) {
        if (!Number.isFinite(value)) return '';
        if (value === 0) return '$0';
        if (value < 0.0001) return '$' + value.toFixed(6);
        if (value < 0.01) return '$' + value.toFixed(5);
        if (value < 1) return '$' + value.toFixed(4);
        return '$' + value.toFixed(3);
    }

    function formatReasoningUsage(meta) {
        if (!meta) return '';
        var parts = [String(meta.model || '')];
        if (meta.inputTokens != null) parts.push('입력 ' + meta.inputTokens.toLocaleString('ko-KR'));
        if (meta.visibleOutputTokens != null) parts.push('응답 ' + meta.visibleOutputTokens.toLocaleString('ko-KR'));
        if (meta.reasoningTokens != null) parts.push('추론 ' + meta.reasoningTokens.toLocaleString('ko-KR'));
        else parts.push('추론 ' + meta.requestedLabel);
        if (meta.totalTokens != null) parts.push('총 ' + meta.totalTokens.toLocaleString('ko-KR') + '토큰');
        if (meta.costUsd != null) {
            var krw = Math.max(0, Math.round(meta.costUsd * (meta.usdKrwRate || USD_KRW_FALLBACK)));
            parts.push('예상 ' + formatUsd(meta.costUsd) + ' ≈ ₩' + krw.toLocaleString('ko-KR'));
        } else {
            parts.push('비용 계산 불가');
        }
        return parts.join(' · ');
    }

    function getUsageTooltip(meta) {
        if (!meta) return '';
        var lines = [
            '유료 API 표준 단가 기준 예상 비용입니다.',
            '모델: ' + meta.model,
            '추론 설정: ' + meta.requestedLabel,
            '가격표 기준일: ' + MODEL_PRICING_UPDATED_AT
        ];
        if (meta.cachedInputTokens) lines.push('캐시 입력: ' + meta.cachedInputTokens.toLocaleString('ko-KR') + ' 토큰');
        if (meta.usdKrwRate) lines.push('환율: 1 USD ≈ ' + Math.round(meta.usdKrwRate).toLocaleString('ko-KR') + ' KRW' + (meta.fxFallback ? ' (임시값)' : ''));
        if (meta.pricingEstimated) lines.push('이 모델 단가는 가장 가까운 공식 모델 단가로 추정했습니다.');
        lines.push('무료 티어, 캐시 정책, 지역 처리, 부가세 및 공급자 청구 반올림에 따라 실제 비용과 다를 수 있습니다.');
        return lines.join('\n');
    }

    function recordAutoMemoryUsage(state, meta) {
        if (!state || !meta) return;
        var saved = {};
        [
            'provider', 'model', 'requested', 'requestedLabel', 'inputTokens', 'outputTokens',
            'visibleOutputTokens', 'billableOutputTokens', 'reasoningTokens', 'totalTokens',
            'cachedInputTokens', 'usdKrwRate', 'fxFallback', 'fxSource', 'costUsd',
            'pricingEstimated', 'longContextPricing'
        ].forEach(function(key) {
            if (meta[key] != null) saved[key] = meta[key];
        });
        saved.recordedAt = Date.now();
        state.lastAutoUsage = saved;
        state.autoUsageCalls = Math.max(0, Number(state.autoUsageCalls) || 0) + 1;
        if (Number.isFinite(meta.costUsd)) state.autoUsageTotalUsd = Math.max(0, Number(state.autoUsageTotalUsd) || 0) + meta.costUsd;
    }

    function formatAutoMemoryUsage(state) {
        var meta = state && state.lastAutoUsage;
        if (!meta) return '자동 AI 비용 · 아직 호출 기록 없음';
        var parts = ['자동 AI ' + (Number(state.autoUsageCalls) || 1).toLocaleString('ko-KR') + '회'];
        if (meta.model) parts.push('마지막 ' + meta.model);
        if (meta.totalTokens != null) parts.push(Number(meta.totalTokens).toLocaleString('ko-KR') + '토큰');
        if (meta.costUsd != null) {
            var lastKrw = Math.max(0, Math.round(meta.costUsd * (meta.usdKrwRate || USD_KRW_FALLBACK)));
            parts.push('마지막 예상 ' + formatUsd(meta.costUsd) + ' ≈ ₩' + lastKrw.toLocaleString('ko-KR'));
        } else {
            parts.push('마지막 비용 계산 불가');
        }
        if (state.autoUsageTotalUsd > 0) {
            var rate = meta.usdKrwRate || USD_KRW_FALLBACK;
            var totalKrw = Math.max(0, Math.round(state.autoUsageTotalUsd * rate));
            parts.push('누적 예상 ' + formatUsd(state.autoUsageTotalUsd) + ' ≈ ₩' + totalKrw.toLocaleString('ko-KR'));
        }
        return parts.join(' · ');
    }

    function getAutoMemoryUsageTooltip(state) {
        if (!state || !state.lastAutoUsage) return '자동 장기기억 AI 호출이 완료되면 채팅별 예상 비용을 기록합니다.';
        return getUsageTooltip(state.lastAutoUsage) + '\n자동 정리 누적 호출: ' + (Number(state.autoUsageCalls) || 1).toLocaleString('ko-KR') + '회';
    }

    function updateVisibleAiUsage() {
        var el = document.getElementById('ce-ai-reasoning-usage');
        if (!el || !LAST_AI_USAGE) return;
        el.textContent = formatReasoningUsage(LAST_AI_USAGE);
        el.title = getUsageTooltip(LAST_AI_USAGE);
        el.classList.remove('is-working');
    }

    // DOM 격리 샌드박스에서는 원격 ESM을 직접 import할 수 없으므로 Firebase 호출만
    // 고정된 page-world 모듈 브리지로 실행한다. Vertex 자격증명은 이 브리지에 전달하지 않는다.
    function callFirebaseViaPage(request, timeoutMs) {
        return new Promise(function(resolve, reject) {
            var randomPart = window.crypto && typeof window.crypto.randomUUID === 'function'
                ? window.crypto.randomUUID().replace(/-/g, '')
                : Date.now().toString(36) + Math.random().toString(36).slice(2);
            var channelId = 'crack-ext-firebase-bridge-' + randomPart;
            var eventName = 'crack-ext-firebase-result-' + randomPart;
            var channel = document.createElement('div');
            var script = document.createElement('script');
            var settled = false;
            var timer;

            channel.id = channelId;
            channel.hidden = true;
            channel.textContent = JSON.stringify(request);
            (document.documentElement || document.body).appendChild(channel);

            function cleanup() {
                if (timer) clearTimeout(timer);
                channel.removeEventListener(eventName, onResult);
                if (script.isConnected) script.remove();
                if (channel.isConnected) channel.remove();
            }

            function finishWithError(error) {
                if (settled) return;
                settled = true;
                cleanup();
                reject(error instanceof Error ? error : new Error(String(error || 'Firebase 호출 실패')));
            }

            function onResult() {
                if (settled) return;
                try {
                    var result = JSON.parse(channel.textContent || '{}');
                    settled = true;
                    cleanup();
                    if (!result.ok) reject(new Error(result.error || 'Firebase AI 호출 실패'));
                    else resolve({ text:String(result.text || ''), usageMetadata:result.usageMetadata || {} });
                } catch (e) {
                    finishWithError(new Error('Firebase 브리지 응답을 해석하지 못했습니다.'));
                }
            }

            channel.addEventListener(eventName, onResult);
            timer = setTimeout(function() {
                finishWithError(new Error('Firebase AI 요청 시간 초과'));
            }, timeoutMs || 90000);

            script.type = 'module';
            var nonceSource = document.querySelector('script[nonce]');
            if (nonceSource && nonceSource.nonce) script.nonce = nonceSource.nonce;
            script.onerror = function() {
                finishWithError(new Error('Firebase SDK 모듈을 불러오지 못했습니다. 페이지 CSP를 확인해주세요.'));
            };
            script.textContent = `
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
import * as FirebaseAI from "https://www.gstatic.com/firebasejs/12.8.0/firebase-ai.js";
const { getAI, getGenerativeModel, VertexAIBackend, HarmBlockThreshold, HarmCategory } = FirebaseAI;
const ThinkingLevel = FirebaseAI.ThinkingLevel || {};
const channel = document.getElementById(${JSON.stringify(channelId)});
const eventName = ${JSON.stringify(eventName)};
const finish = payload => {
  if (!channel) return;
  channel.textContent = JSON.stringify(payload);
  channel.dispatchEvent(new Event(eventName));
};
try {
  const req = JSON.parse(channel.textContent || "{}");
  const app = initializeApp(req.firebaseConfig, req.appName);
  const ai = getAI(app, { backend:new VertexAIBackend("global") });
  const safetySettings = [
    { category:HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold:HarmBlockThreshold.OFF },
    { category:HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold:HarmBlockThreshold.OFF },
    { category:HarmCategory.HARM_CATEGORY_HARASSMENT, threshold:HarmBlockThreshold.OFF },
    { category:HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold:HarmBlockThreshold.OFF }
  ];
  const generationConfig = req.generationConfig || {};
  if (req.thinkingConfig) {
    if (req.thinkingConfig.thinkingLevel) {
      const enumKey = String(req.thinkingConfig.thinkingLevel).toUpperCase();
      generationConfig.thinkingConfig = { thinkingLevel:ThinkingLevel?.[enumKey] || req.thinkingConfig.thinkingLevel };
    } else {
      generationConfig.thinkingConfig = req.thinkingConfig;
    }
  }
  const model = getGenerativeModel(ai, {
    model:req.model,
    systemInstruction:req.systemInstruction,
    safetySettings,
    generationConfig
  });
  const generated = await model.generateContent(req.prompt);
  const response = await generated.response;
  finish({ ok:true, text:response.text(), usageMetadata:response.usageMetadata || {} });
} catch (error) {
  finish({ ok:false, error:String(error && error.message || error || "Firebase AI 호출 실패").slice(0, 500) });
}`;
            (document.head || document.documentElement).appendChild(script);
        });
    }

    async function callAI(provider, config, chatLog, turns, style, isCompress, options) {
        options = options || {};
        LAST_AI_USAGE = null;
        const promptMode = options.promptMode === 'auto' ? 'auto' : (isCompress ? 'compress' : 'main');
        const currentPrompt = options.systemPrompt || buildSystemPrompt(getActivePromptText(promptMode));
        const reasoningValue = config.reasoning || 'auto';

        const styleInstruction = isCompress ? '' : (style === 'concise'
            ? '\n[간결 모드] 사용자 프롬프트의 구성은 유지하면서 핵심 사건과 전환점을 우선한다.'
            : '\n[상세 모드] 사용자 프롬프트의 구성은 유지하면서 감정 변화, 관계 역학, 분위기와 구체적 반응을 더 충실히 보존한다.');

        const taskPrompt = options.inputPrompt || (isCompress
            ? `[압축 대상 장기기억 목록]\n${chatLog}\n\n위 장기기억들을 선택된 사용자 프롬프트에 따라 압축정리하라.`
            : `[요약 대상]\n제공된 대화는 총 ${turns}턴 분량입니다.\n처음부터 끝까지 모든 흐름을 확인한 뒤 선택된 사용자 프롬프트에 따라 요약하세요.\n${styleInstruction}\n\n[채팅 내역 시작]\n${chatLog}\n[채팅 내역 끝]`);
        const reinforcedPrompt = `${BUILTIN_FULL_COVERAGE_REQUIREMENT}\n\n${taskPrompt}`;

        if (provider === 'google') {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;
            const generationConfig = getGeminiGenerationConfig(config.model);
            const thinkingConfig = getGeminiThinkingConfig(config.model, reasoningValue);
            if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig;
            if (options.jsonMode) generationConfig.responseMimeType = 'application/json';
            const payload = {
                system_instruction: { parts:[{ text:currentPrompt }] },
                contents: [{ role:'user', parts:[{ text:reinforcedPrompt }] }],
                generationConfig:generationConfig
            };
            const response = await fetch(url, {
                method:'POST',
                headers:{ 'Content-Type':'application/json' },
                body:JSON.stringify(payload)
            });
            if (!response.ok) throw new Error(await readApiError(response, 'Gemini API 에러'));
            const data = await response.json();
            const text = extractGeminiResponseText(data);
            if (!text.trim()) throw new Error('Gemini 응답에 텍스트가 없습니다.');
            setGeminiUsage(provider, config.model, reasoningValue, data.usageMetadata);
            return text;
        }

        if (provider === 'vertex') {
            const serviceAccount = parseVertexServiceAccount(config.vertexJson);
            const projectId = String(config.vertexProjectId || serviceAccount.projectId || '').trim();
            const endpoint = resolveVertexEndpoint(config.vertexLocation || 'global', projectId, config.model);
            const generationConfig = getGeminiGenerationConfig(config.model);
            const thinkingConfig = getGeminiThinkingConfig(config.model, reasoningValue);
            if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig;
            if (options.jsonMode) generationConfig.responseMimeType = 'application/json';
            const payload = {
                systemInstruction:{ parts:[{ text:currentPrompt }] },
                contents:[{ role:'user', parts:[{ text:reinforcedPrompt }] }],
                generationConfig:generationConfig
            };

            async function sendVertexRequest(forceRefresh) {
                const accessToken = await getVertexAccessToken(serviceAccount, forceRefresh);
                return vertexHttpRequest(endpoint.url, {
                    method:'POST',
                    headers:{
                        'Content-Type':'application/json',
                        'Authorization':'Bearer ' + accessToken
                    },
                    body:JSON.stringify(payload),
                    timeout:90000
                });
            }

            let response = await sendVertexRequest(false);
            if (response.status === 401) {
                clearVertexAccessToken(serviceAccount);
                response = await sendVertexRequest(true);
            }
            if (!response.ok) throw new Error(await readApiError(response, 'Vertex AI API 에러'));
            const data = await response.json();
            const text = extractGeminiResponseText(data);
            if (!text.trim()) {
                const feedback = data && data.promptFeedback && data.promptFeedback.blockReason;
                const finishReason = data && data.candidates && data.candidates[0] && data.candidates[0].finishReason;
                throw new Error('Vertex 응답에 텍스트가 없습니다.' + (feedback || finishReason ? ' (' + (feedback || finishReason) + ')' : ''));
            }
            setGeminiUsage(provider, config.model, reasoningValue, data.usageMetadata);
            return text;
        }

        if (provider === 'deepseek') {
            const payload = {
                model:config.model,
                messages:[
                    { role:'system', content:currentPrompt },
                    { role:'user', content:reinforcedPrompt }
                ],
                max_tokens:8192
            };
            if (reasoningValue === 'off') {
                payload.thinking = { type:'disabled' };
                payload.temperature = 0.2;
                payload.top_p = 0.8;
            } else if (reasoningValue === 'high' || reasoningValue === 'max') {
                payload.thinking = { type:'enabled' };
                payload.reasoning_effort = reasoningValue;
            }
            const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
                method:'POST',
                headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + config.apiKey },
                body:JSON.stringify(payload)
            });
            if (!response.ok) throw new Error(await readApiError(response, 'DeepSeek API 에러'));
            const data = await response.json();
            const text = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
            if (!text || !text.trim()) throw new Error('DeepSeek 응답에 텍스트가 없습니다.');
            const usage = data.usage || {};
            const details = usage.completion_tokens_details || {};
            setLastAiUsage(provider, config.model, reasoningValue, {
                inputTokens:usage.prompt_tokens,
                outputTokens:usage.completion_tokens,
                reasoningTokens:details.reasoning_tokens,
                totalTokens:usage.total_tokens,
                cachedInputTokens:usage.prompt_cache_hit_tokens
            });
            return text;
        }

        if (provider === 'openai') {
            const payload = {
                model:config.model,
                instructions:currentPrompt,
                input:reinforcedPrompt
            };
            if (reasoningValue && reasoningValue !== 'auto') payload.reasoning = { effort:reasoningValue };
            const response = await fetch('https://api.openai.com/v1/responses', {
                method:'POST',
                headers:{
                    'Content-Type':'application/json',
                    'Authorization':'Bearer ' + config.apiKey
                },
                body:JSON.stringify(payload)
            });
            if (!response.ok) throw new Error(await readApiError(response, 'OpenAI API 에러'));
            const data = await response.json();
            if (data && data.error) throw new Error(data.error.message || 'OpenAI API 에러');
            const text = extractOpenAIText(data);
            if (!text) throw new Error('OpenAI 응답에 텍스트가 없습니다.');
            const usage = data.usage || {};
            const details = usage.output_tokens_details || {};
            setLastAiUsage(provider, config.model, reasoningValue, {
                inputTokens:usage.input_tokens,
                outputTokens:usage.output_tokens,
                reasoningTokens:details.reasoning_tokens,
                totalTokens:usage.total_tokens,
                cachedInputTokens:usage.input_tokens_details && usage.input_tokens_details.cached_tokens
            });
            return text;
        }

        if (provider === 'firebase') {
            const firebaseConfig = parseFirebaseConfig(config.firebaseScript);
            if (!firebaseConfig) throw new Error('Firebase 스크립트 형식이 올바르지 않습니다.');
            const generationConfig = getGeminiGenerationConfig(config.model);
            const rawThinkingConfig = getGeminiThinkingConfig(config.model, reasoningValue);
            if (options.jsonMode) generationConfig.responseMimeType = 'application/json';
            const bridgeResult = await callFirebaseViaPage({
                firebaseConfig:firebaseConfig,
                appName:'crack-ext-' + Date.now() + '-' + Math.random().toString(36).slice(2),
                model:config.model,
                systemInstruction:currentPrompt,
                prompt:reinforcedPrompt,
                generationConfig:generationConfig,
                thinkingConfig:rawThinkingConfig
            }, 90000);
            const text = bridgeResult.text;
            if (!text || !text.trim()) throw new Error('Firebase AI 응답에 텍스트가 없습니다.');
            setGeminiUsage(provider, config.model, reasoningValue, bridgeResult.usageMetadata);
            return text;
        }
        throw new Error('알 수 없는 API 제공자');
    }

    function sanitizeFirebaseConfigObject(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        var allowedKeys = ['apiKey','authDomain','databaseURL','projectId','storageBucket','messagingSenderId','appId','measurementId'];
        var result = {};
        allowedKeys.forEach(function(key) {
            if (typeof value[key] === 'string') result[key] = value[key];
        });
        return result.apiKey && result.projectId ? result : null;
    }

    function extractFirebaseObjectLiteral(source, startAt) {
        var open = source.indexOf('{', Math.max(0, startAt || 0));
        if (open < 0) return '';
        var depth = 0;
        var quote = '';
        var escaped = false;
        for (var i = open; i < source.length; i++) {
            var ch = source[i];
            if (quote) {
                if (escaped) escaped = false;
                else if (ch === '\\') escaped = true;
                else if (ch === quote) quote = '';
                continue;
            }
            if (ch === '"' || ch === "'" || ch === '`') {
                quote = ch;
                continue;
            }
            if (ch === '{') depth++;
            else if (ch === '}' && --depth === 0) return source.slice(open, i + 1);
        }
        return '';
    }

    function decodeFirebaseStaticString(raw, quote) {
        if (quote === '"') {
            try { return JSON.parse('"' + raw + '"'); } catch (e) { return null; }
        }
        if (quote === '`' && raw.includes('${')) return null;
        var controls = { b:'\b', f:'\f', n:'\n', r:'\r', t:'\t', v:'\v', '0':'\0' };
        return raw
            .replace(/\\u([0-9a-fA-F]{4})/g, function(_, hex) { return String.fromCharCode(parseInt(hex, 16)); })
            .replace(/\\x([0-9a-fA-F]{2})/g, function(_, hex) { return String.fromCharCode(parseInt(hex, 16)); })
            .replace(/\\(.)/g, function(_, escaped) { return Object.prototype.hasOwnProperty.call(controls, escaped) ? controls[escaped] : escaped; });
    }

    function parseFirebaseTopLevelStaticStrings(objectLiteral) {
        var parsed = {};
        var source = String(objectLiteral || '');
        var i = source[0] === '{' ? 1 : 0;

        function skipSpaceAndComments() {
            while (i < source.length) {
                if (/\s|,/.test(source[i])) { i++; continue; }
                if (source[i] === '/' && source[i + 1] === '/') {
                    i += 2;
                    while (i < source.length && source[i] !== '\n') i++;
                    continue;
                }
                if (source[i] === '/' && source[i + 1] === '*') {
                    i += 2;
                    while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
                    i = Math.min(source.length, i + 2);
                    continue;
                }
                break;
            }
        }

        function readQuoted() {
            var quote = source[i++];
            var raw = '';
            var escaped = false;
            while (i < source.length) {
                var ch = source[i++];
                if (escaped) {
                    raw += '\\' + ch;
                    escaped = false;
                } else if (ch === '\\') {
                    escaped = true;
                } else if (ch === quote) {
                    return { raw:raw, quote:quote };
                } else {
                    raw += ch;
                }
            }
            return null;
        }

        function skipValue() {
            var depth = 0;
            var quote = '';
            var escaped = false;
            while (i < source.length) {
                var ch = source[i];
                if (quote) {
                    i++;
                    if (escaped) escaped = false;
                    else if (ch === '\\') escaped = true;
                    else if (ch === quote) quote = '';
                    continue;
                }
                if (ch === '"' || ch === "'" || ch === '`') { quote = ch; i++; continue; }
                if (ch === '{' || ch === '[' || ch === '(') { depth++; i++; continue; }
                if (ch === '}' || ch === ']' || ch === ')') {
                    if (depth === 0) return;
                    depth--;
                    i++;
                    continue;
                }
                if (ch === ',' && depth === 0) return;
                i++;
            }
        }

        while (i < source.length) {
            skipSpaceAndComments();
            if (source[i] === '}' || i >= source.length) break;

            var key = '';
            if (source[i] === '"' || source[i] === "'") {
                var quotedKey = readQuoted();
                if (!quotedKey) break;
                key = decodeFirebaseStaticString(quotedKey.raw, quotedKey.quote) || '';
            } else {
                var keyMatch = source.slice(i).match(/^[A-Za-z_$][\w$]*/);
                if (!keyMatch) { skipValue(); if (source[i] === ',') i++; continue; }
                key = keyMatch[0];
                i += key.length;
            }

            skipSpaceAndComments();
            if (source[i] !== ':') { skipValue(); if (source[i] === ',') i++; continue; }
            i++;
            skipSpaceAndComments();

            if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
                var quotedValue = readQuoted();
                if (!quotedValue) break;
                var decoded = decodeFirebaseStaticString(quotedValue.raw, quotedValue.quote);
                if (decoded !== null) parsed[key] = decoded;
            } else {
                skipValue();
            }
            skipValue();
            if (source[i] === ',') i++;
        }
        return parsed;
    }

    function parseFirebaseConfig(scriptStr) {
        var source = String(scriptStr || '').trim();
        if (!source) return null;
        try {
            if (source[0] === '{') {
                var direct = sanitizeFirebaseConfigObject(JSON.parse(source));
                if (direct) return direct;
            }
        } catch (e) {}

        var assignmentIndex = source.search(/firebaseConfig\s*=/i);
        var objectLiteral = extractFirebaseObjectLiteral(source, assignmentIndex >= 0 ? assignmentIndex : 0);
        if (!objectLiteral) return null;
        return sanitizeFirebaseConfigObject(parseFirebaseTopLevelStaticStrings(objectLiteral));
    }

    // ============== 내보내기 ==============
    function exportAsTxt(cards) {
        let content = '';
        cards.forEach(card => { content += '[' + card.title + ']\n' + card.summary + '\n\n'; });
        return content.trim();
    }

    function exportAsJson(cards) {
        return JSON.stringify({
            exportedAt: new Date().toISOString(),
            totalCards: cards.length,
            summaries: cards.map(card => ({ title: card.title, summary: card.summary }))
        }, null, 2);
    }

    function exportAsMarkdown(cards) {
        let content = '# 📔 장기기억 아카이브 요약\n\n';
        content += '> 내보낸 날짜: ' + new Date().toLocaleString('ko-KR') + '\n';
        content += '> 총 ' + cards.length + '개의 사건 요약\n\n---\n\n';
        cards.forEach((card, index) => {
            content += '## ' + (index + 1) + '. ' + card.title + '\n\n' + card.summary + '\n\n';
            if (index < cards.length - 1) content += '---\n\n';
        });
        return content;
    }

    function downloadFile(content, filename, mimeType) {
        const blob = new Blob(['\uFEFF' + content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ============== 스타일 ==============
    function injectAiStyles() {
        if (document.getElementById('crack-ext-ai-css')) return;
        const s = document.createElement('style');
        s.id = 'crack-ext-ai-css';
        s.textContent = `
.crack-ext-ai-overlay{background:rgba(0,0,0,.5);z-index:100000;position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:auto!important}
.crack-ext-ai-modal{background:#fff!important;border-radius:16px;padding:24px;width:680px;max-width:92vw;max-height:92vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,.2);pointer-events:auto!important;color:#222!important}
.crack-ext-ai-modal-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
.crack-ext-ai-modal-header h3{margin:0;color:#222!important;font-size:17px;font-weight:700;min-width:0}
.crack-ext-ai-modal-header-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex:0 0 auto}
.crack-ext-ai-close-btn{display:inline-flex;align-items:center;justify-content:center;width:26px!important;height:26px!important;min-width:26px!important;padding:0!important;margin:0!important;border:0!important;border-radius:0!important;background:transparent!important;color:#666!important;font-size:25px!important;font-weight:300!important;line-height:1!important;cursor:pointer;transition:color .18s,opacity .18s;box-shadow:none!important}
.crack-ext-ai-close-btn:hover{background:transparent!important;color:#111!important;opacity:.72}
.crack-ext-ai-close-btn:focus-visible{outline:2px solid rgba(110,142,251,.55);outline-offset:2px}
.crack-ext-ai-close-btn:disabled{opacity:.35;cursor:not-allowed}
.crack-ext-ai-modal label{display:flex;font-size:13px;font-weight:600;margin-bottom:4px;color:#333!important;align-items:center;justify-content:space-between}
.crack-ext-ai-modal input,.crack-ext-ai-modal textarea,.crack-ext-ai-modal select{width:100%;padding:8px 10px;border:1px solid #ddd!important;border-radius:8px;font-size:13px;box-sizing:border-box;font-family:inherit;pointer-events:auto!important;background-color:#fff!important;color:#222!important}
.crack-ext-ai-modal-btns{display:flex;gap:8px;justify-content:space-between;align-items:flex-end;margin-top:16px}
.crack-ext-ai-mbtn{padding:8px 18px;border-radius:8px;border:1px solid #ddd!important;background:#fff!important;color:#222!important;cursor:pointer;font-size:13px;font-weight:600;transition:background 0.2s}
.crack-ext-ai-mbtn:hover{background:#f5f5f5!important}
.crack-ext-ai-mbtn-p{background:#222!important;color:#fff!important;border-color:#222!important}
.crack-ext-ai-mbtn-p:hover{background:#444!important}
.crack-ext-ai-mbtn-p:disabled,.crack-ext-ai-mbtn:disabled{background:#ccc!important;border-color:#ccc!important;color:#666!important;cursor:not-allowed}
.crack-ext-ai-mbtn-save{background:#4CAF50!important;color:#fff!important;border-color:#4CAF50!important;font-size:11px!important;padding:6px 12px!important}
.crack-flex-ai-row{display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap}
.crack-flex-ai-row .fg{flex:1;min-width:100px}
.crack-ext-auto-panel{margin:0 0 16px;border:1px solid var(--ce-line,#ddd);border-radius:12px;background:var(--ce-card,#fafafa);overflow:hidden}
.crack-ext-auto-panel>summary{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px;cursor:pointer;color:var(--ce-ink,#222);font-size:.875rem;font-weight:700;list-style:none}
.crack-ext-auto-panel>summary::-webkit-details-marker{display:none}
.crack-ext-auto-panel>summary::after{content:"+";flex:0 0 auto;color:var(--ce-ink-faint,#888);font-size:1.25rem;font-weight:400;line-height:1}
.crack-ext-auto-panel[open]>summary::after{content:"−"}
.crack-ext-auto-summary-status{min-width:0;margin-left:auto;color:var(--ce-ink-faint,#777);font-size:.875rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.crack-ext-auto-body{padding:0 16px 16px;border-top:1px solid var(--ce-line-soft,#eee)}
.crack-ext-auto-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;padding-top:16px}
.crack-ext-auto-field{min-width:0}
.crack-ext-auto-field label{display:block!important;margin:0 0 8px!important;color:var(--ce-ink-dim,#555)!important;font-size:.875rem!important;font-weight:600!important;line-height:1.3}
.crack-ext-auto-field input[type="number"]{height:40px!important;padding:8px 10px!important;font-variant-numeric:tabular-nums}
.crack-ext-auto-toggle-row{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:16px 0 0}
.crack-ext-auto-check{display:inline-flex!important;align-items:center!important;justify-content:flex-start!important;gap:8px!important;width:auto!important;margin:0!important;color:var(--ce-ink-dim,#555)!important;font-size:.875rem!important;font-weight:600!important}
.crack-ext-auto-check input[type="checkbox"]{width:18px!important;height:18px!important;min-width:18px!important;margin:0!important;padding:0!important;accent-color:var(--ce-sage,#4f8069)}
.crack-ext-auto-note{margin:16px 0 0;padding:12px 16px;border-left:3px solid var(--ce-sage,#4f8069);background:var(--ce-sage-glow,rgba(79,128,105,.13));color:var(--ce-ink-dim,#555);font-size:.875rem;line-height:1.6}
.crack-ext-auto-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:16px}
.crack-ext-auto-status{flex:1 1 240px;min-width:0;color:var(--ce-ink-faint,#777);font-size:.875rem;line-height:1.6;word-break:break-word}
.crack-ext-auto-usage{margin-top:10px;padding-top:10px;border-top:1px dashed var(--ce-line-soft,#eee);color:var(--ce-ink-dim,#555);font-size:.8125rem;line-height:1.55;word-break:break-word;font-variant-numeric:tabular-nums}
#ce-auto-run:not(:disabled){background:var(--ce-sage-glow,rgba(79,128,105,.13))!important;color:var(--ce-sage,#4f8069)!important;border-color:color-mix(in srgb,var(--ce-sage,#4f8069) 42%,transparent)!important}
@media(max-width:760px){.crack-ext-auto-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.crack-ext-auto-summary-status{display:none}}
@media(max-width:430px){.crack-ext-auto-grid{grid-template-columns:1fr}.crack-ext-auto-actions .crack-ext-ai-mbtn{flex:1 1 auto}.crack-ext-auto-status{flex-basis:100%}}
#ce-ai-preview-container{margin-top:10px}
#ce-ai-card-nav{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:6px;font-size:12px;font-weight:bold}
#ce-ai-card-nav button{cursor:pointer;background:#f0f0f0;border:1px solid #ddd;border-radius:6px;padding:4px 10px;font-size:11px;color:#333}
#ce-ai-card-nav button:hover{background:#e4e4e4}
.crack-ext-session-card{background:#f9f9f9!important;border:1px solid #eee!important;border-radius:8px;padding:10px;font-size:12px;margin-bottom:6px}
.crack-ext-session-title{font-weight:bold;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center}
.crack-ext-session-content{color:#555!important;line-height:1.4;white-space:pre-wrap;word-break:break-all}
.crack-ext-char-count{font-size:10px;font-weight:normal;color:#777}
.crack-ext-count-error{color:#e74c3c!important;font-weight:bold}
.crack-ext-header-ai-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:0 8px!important;height:29px!important;border-radius:7px!important;background:transparent!important;color:#514e49!important;font-weight:680!important;font-size:11.5px!important;border:1px solid transparent!important;cursor:pointer;white-space:nowrap!important;box-shadow:none!important;opacity:1;transition:background .18s,border-color .18s,color .18s!important}
.crack-ext-header-ai-btn:hover{background:rgba(31,29,26,.055)!important;border-color:rgba(31,29,26,.07)!important;color:#353330!important;opacity:1}
.crack-ext-header-ai-btn .crack-ext-header-ai-icon{display:block;width:14px;height:14px;color:#6f6b65;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.crack-ext-header-ai-btn.crack-ext-floating,.crack-ext-header-ai-btn.crack-ext-header-fallback{position:fixed!important;top:max(56px,calc(env(safe-area-inset-top,0px) + 44px))!important;right:max(10px,env(safe-area-inset-right,0px))!important;bottom:auto!important;left:auto!important;z-index:99990!important;width:44px!important;min-width:44px!important;height:44px!important;padding:0!important;margin:0!important;border:1px solid #d8cab7!important;border-radius:12px!important;background:rgba(255,251,244,.96)!important;color:#6e5f4c!important;box-shadow:0 7px 22px rgba(61,43,23,.22)!important;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);touch-action:manipulation;pointer-events:auto!important}
.crack-ext-header-ai-btn.crack-ext-floating span,.crack-ext-header-ai-btn.crack-ext-header-fallback span{display:none!important}
.crack-ext-header-ai-btn.crack-ext-floating .crack-ext-header-ai-icon,.crack-ext-header-ai-btn.crack-ext-header-fallback .crack-ext-header-ai-icon{width:18px!important;height:18px!important}
.crack-ext-header-ai-btn.crack-ext-floating:active,.crack-ext-header-ai-btn.crack-ext-header-fallback:active{transform:scale(.96)}
.crack-ext-export-btn{padding:5px 10px;border-radius:6px;border:1px solid #ddd;background:#fff;color:#333;cursor:pointer;font-size:11px;transition:background 0.2s}
.crack-ext-export-btn:hover{background:#f0f0f0}
.crack-ext-compress-list{max-height:250px;overflow-y:auto;border:1px solid #ddd;border-radius:8px;padding:8px;margin-top:4px}
.crack-ext-compress-item{display:flex;align-items:flex-start;gap:8px;padding:6px 4px;border-bottom:1px solid #eee;font-size:12px;cursor:pointer}
.crack-ext-compress-item:hover{background:#f5f5f5}
.crack-ext-compress-item input[type=checkbox]{margin-top:2px;width:auto!important;min-width:auto!important}
.crack-ext-compress-item .item-title{font-weight:600;color:#333}
.crack-ext-compress-item .item-summary{color:#777;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:400px}
.crack-ext-compress-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
.crack-ext-compress-header span{font-size:12px;color:#666}
.crack-ext-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;margin-left:4px}
.crack-ext-badge-compress{background:#fef3c7;color:#92400e}
.crack-ext-prompt-save-row{display:flex;align-items:center;gap:8px;margin-top:4px}
.crack-ext-export-actions{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.crack-ext-prompt-header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:4px}
.crack-ext-prompt-heading{display:flex;flex-direction:column;gap:2px;min-width:0}
.crack-ext-prompt-heading-main{font-size:13px;font-weight:600;color:#333}
.crack-ext-result-title-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.crack-ext-reasoning-usage{display:inline-block;max-width:100%;font-size:10.5px;font-weight:560;color:#776f65;line-height:1.45;white-space:normal;word-break:keep-all;cursor:help}
.crack-ext-reasoning-usage.is-working{opacity:.72}
.crack-ext-prompt-heading-sub{display:none;font-size:10px;font-weight:400;color:#888;line-height:1.35}
.crack-ext-prompt-selects{display:flex;align-items:flex-end;justify-content:flex-end;gap:6px;flex-wrap:wrap;min-width:0}
.crack-ext-prompt-field{display:flex;flex-direction:column;gap:3px;min-width:0}
.crack-ext-prompt-field-label{display:none;font-size:10px;font-weight:600;color:#777;line-height:1}
.crack-ext-prompt-field select{width:auto!important;max-width:180px;font-size:11px!important;padding:4px 8px!important}
.crack-ext-prompt-edit-actions{display:none;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap}
.crack-ext-prompt-header.is-editing{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 12px;padding:11px 12px;border:1px solid #e5e7eb;border-radius:10px;background:#fafafa;margin-bottom:8px}
.crack-ext-prompt-header.is-editing .crack-ext-prompt-heading-sub{display:block}
.crack-ext-prompt-header.is-editing .crack-ext-prompt-edit-actions{display:flex}
.crack-ext-prompt-header.is-editing .crack-ext-prompt-selects{grid-column:1/-1;display:grid;grid-template-columns:minmax(115px,.7fr) minmax(180px,1.3fr);justify-content:stretch;gap:8px;margin-top:0}
.crack-ext-prompt-header.is-editing .crack-ext-prompt-field-label{display:block}
.crack-ext-prompt-header.is-editing .crack-ext-prompt-field select{width:100%!important;max-width:none!important}
.crack-ext-prompt-header.is-editing #ce-ai-selection-counter,.crack-ext-prompt-header.is-editing #ce-ai-toggle-prompt{display:none!important}
.crack-ext-prompt-tool-btn{font-size:11px!important;padding:5px 9px!important}
.crack-ext-prompt-icon-btn{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:32px!important;height:32px!important;min-width:32px!important;padding:0!important;border-radius:8px!important;font-size:17px!important;line-height:1!important}
.crack-ext-prompt-icon-btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
.crack-ext-prompt-icon-btn.is-save{background:#222!important;color:#fff!important;border-color:#222!important}
.crack-ext-prompt-icon-btn.is-save:hover{background:#444!important}
.crack-ext-prompt-icon-btn.is-delete{background:#fff!important;color:#dc2626!important;border-color:#fca5a5!important}
.crack-ext-prompt-icon-btn.is-delete:hover{background:#fff1f2!important;color:#b91c1c!important}
.crack-ext-ai-footer-right{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-left:auto}
.crack-ext-ui-dialog-overlay{position:fixed;inset:0;z-index:1000001;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.42);box-sizing:border-box}
.crack-ext-ui-dialog{width:360px;max-width:100%;background:#fff;color:#222;border-radius:14px;padding:20px;box-shadow:0 12px 42px rgba(0,0,0,.28);box-sizing:border-box}
.crack-ext-ui-dialog h4{margin:0 0 8px;font-size:15px;color:#222}
.crack-ext-ui-dialog p{margin:0 0 14px;font-size:12px;line-height:1.55;color:#666;white-space:pre-wrap}
.crack-ext-ui-dialog input{width:100%;padding:9px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;box-sizing:border-box;background:#fff;color:#222}
.crack-ext-ui-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
.crack-ext-ui-dialog-error{min-height:16px;margin-top:5px;font-size:10px;color:#dc2626}
.crack-ext-editor-check-label{display:inline-flex!important;align-items:center!important;justify-content:flex-start!important;gap:6px!important;width:auto!important;min-width:0!important;margin:0!important;white-space:nowrap;font-weight:500!important;line-height:1.2}
.crack-ext-editor-check-label input[type=checkbox]{flex:0 0 auto!important;width:16px!important;height:16px!important;min-width:16px!important;margin:0!important;padding:0!important}
.crack-ext-editor-card.is-selected{border-color:#60a5fa;box-shadow:0 0 0 2px rgba(96,165,250,.14)}
.crack-ext-editor-card-title{display:flex;align-items:center;gap:10px;min-width:0}
.crack-ext-editor-bulk-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}


.crack-ext-editor-modal{width:1040px!important;max-width:96vw!important}
.crack-ext-editor-toolbar{position:sticky;top:-24px;z-index:3;background:#fff;padding:10px 0 12px;border-bottom:1px solid #eee;margin-bottom:12px}
.crack-ext-editor-search-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.crack-ext-editor-search-row input{flex:1;min-width:220px}
.crack-ext-editor-list{display:flex;flex-direction:column;gap:14px}
.crack-ext-editor-card{border:1px solid #e5e7eb;border-radius:12px;padding:14px;background:#fafafa;transition:.2s}
.crack-ext-editor-card.is-changed{border-color:#a777e3;box-shadow:0 0 0 2px rgba(167,119,227,.12)}
.crack-ext-editor-card.is-delete{border-color:#ef4444;background:#fff1f2;opacity:.86}
.crack-ext-editor-card.is-error{border-color:#ef4444!important;box-shadow:0 0 0 2px rgba(239,68,68,.12)}
.crack-ext-editor-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
.crack-ext-editor-index{font-size:12px;font-weight:700;color:#666}
.crack-ext-editor-actions{display:flex;gap:6px;flex-wrap:wrap}
.crack-ext-editor-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.crack-ext-editor-pane{border-radius:9px;padding:10px;border:1px solid #e5e7eb;background:#fff}
.crack-ext-editor-pane h4{margin:0 0 8px;font-size:12px;color:#666}
.crack-ext-editor-original{font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word;color:#555}
.crack-ext-editor-title-input{margin-bottom:8px}
.crack-ext-editor-summary-input{min-height:112px;resize:vertical}
.crack-ext-editor-meta{display:flex;justify-content:space-between;gap:8px;margin-top:7px;font-size:10px;color:#777}
.crack-ext-editor-status{font-weight:700}
.crack-ext-editor-danger{background:#fff!important;color:#dc2626!important;border-color:#fca5a5!important}
.crack-ext-editor-danger:hover{background:#fff1f2!important}
.crack-ext-editor-restore{font-size:11px!important;padding:5px 9px!important}
.crack-ext-editor-empty{text-align:center;padding:40px 10px;color:#999}
@media(max-width:760px){
.crack-ext-ai-overlay{padding:8px;box-sizing:border-box}
.crack-ext-ai-modal{width:calc(100vw - 16px)!important;max-width:none!important;max-height:calc(100vh - 16px)!important;max-height:calc(100dvh - 16px)!important;padding:16px!important;border-radius:14px;box-sizing:border-box}
.crack-ext-ai-modal-header{position:sticky;top:-16px;z-index:20;background:inherit;padding:0 0 10px;margin-bottom:12px}
.crack-ext-ai-modal-btns{position:sticky;bottom:-16px!important;z-index:20;background:inherit;padding:10px 0 0;flex-wrap:wrap}
.crack-ext-ai-footer-right{width:100%;justify-content:flex-end}
.crack-ext-ai-modal-btns>div:first-child:not(.crack-ext-ai-footer-right){width:100%}
.crack-ext-ai-modal-btns>div:first-child:not(.crack-ext-ai-footer-right) .crack-ext-ai-mbtn{flex:1 1 auto}
.crack-ext-editor-grid{grid-template-columns:1fr}
.crack-ext-editor-modal{width:calc(100vw - 16px)!important;max-width:none!important}
.crack-ext-editor-toolbar{top:27px;padding-top:8px}
.crack-ext-editor-search-row input{min-width:100%}
.crack-ext-editor-search-row{align-items:stretch}
.crack-ext-editor-bulk-actions{width:100%}
.crack-ext-compress-header{align-items:flex-start;gap:8px;flex-wrap:wrap}
.crack-ext-compress-list{max-height:44vh;max-height:44dvh}
.crack-ext-prompt-header{align-items:flex-start;flex-direction:column}
.crack-ext-prompt-selects{width:100%;justify-content:flex-start}
.crack-ext-prompt-field{flex:1 1 130px}
.crack-ext-prompt-field select{width:100%!important;max-width:none!important}
.crack-ext-prompt-header.is-editing{grid-template-columns:minmax(0,1fr) auto;padding:10px}
.crack-ext-prompt-header.is-editing .crack-ext-prompt-selects{grid-template-columns:1fr}
.crack-ext-prompt-edit-actions{gap:4px}
.crack-ext-prompt-icon-btn{width:34px!important;height:34px!important;min-width:34px!important}
#ce-ai-result{min-height:170px}
.crack-ext-ui-dialog-overlay{padding:12px}
.crack-ext-ui-dialog{width:min(360px,calc(100vw - 24px));padding:18px}
}
@media(max-width:430px){
.crack-flex-ai-row .fg{min-width:100%}
.crack-ext-ai-modal{padding:14px!important;max-height:calc(100vh - 16px)!important;max-height:calc(100dvh - 16px)!important}
.crack-ext-ai-modal-header{top:-14px}
.crack-ext-ai-modal-btns{bottom:-14px!important}
.crack-ext-ai-mbtn{padding:8px 12px}
.crack-ext-editor-card{padding:10px}
.crack-ext-editor-card-head{align-items:flex-start}
.crack-ext-editor-actions{justify-content:flex-end}
.crack-ext-prompt-header.is-editing{grid-template-columns:1fr}
.crack-ext-prompt-header.is-editing .crack-ext-prompt-edit-actions{grid-row:2;justify-content:flex-start}
.crack-ext-prompt-header.is-editing .crack-ext-prompt-selects{grid-row:3}
}
@media(max-height:520px) and (max-width:760px){
.crack-ext-ai-overlay{align-items:center;padding:4px}
.crack-ext-ai-modal{max-height:calc(100vh - 8px)!important;max-height:calc(100dvh - 8px)!important}
}
.crack-ext-ui-dialog{position:relative;overflow:hidden}
.crack-ext-ui-dialog::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:#222}
.crack-ext-ui-dialog.is-danger::before{background:#dc2626}
.crack-ext-ui-dialog.is-warning::before{background:#d97706}
.crack-ext-ui-dialog.is-success::before{background:#16a34a}
.crack-ext-ui-dialog-message{max-height:min(48vh,360px);overflow:auto;padding-right:2px}
.crack-ext-toast{position:fixed;top:max(20px,env(safe-area-inset-top));left:50%;transform:translateX(-50%) translateY(-10px);z-index:999999999;background:#fff;color:#222;border:1px solid #e5e7eb;padding:11px 16px;border-radius:10px;font-size:13px;font-weight:600;box-shadow:0 8px 28px rgba(0,0,0,.18);transition:opacity .3s,transform .3s;max-width:min(520px,calc(100vw - 32px));word-break:break-word}
@media(max-width:480px){.crack-ext-ui-dialog-message{max-height:42vh}.crack-ext-toast{top:max(12px,env(safe-area-inset-top));max-width:calc(100vw - 24px);padding:10px 14px}}

/* ==========================================================
   기억 서고 테마 — 원본 기능·문구·폰트 유지
   ========================================================== */
.crack-ext-ai-overlay,
.crack-ext-ui-dialog-overlay,
.crack-ext-toast{
--ce-bg:#F3EDE2;
--ce-panel:#FFFBF4;
--ce-panel-2:#F8F0E4;
--ce-card:#FBF5EA;
--ce-card-hi:#F2E8D9;
--ce-line:#D8CAB7;
--ce-line-soft:#E8DDCE;
--ce-ink:#362E25;
--ce-ink-dim:#746858;
--ce-ink-faint:#9A8C7A;
--ce-amber:#B67822;
--ce-amber-deep:#8F5B18;
--ce-amber-glow:rgba(182,120,34,.14);
--ce-sage:#4F8069;
--ce-sage-deep:#3B6854;
--ce-sage-glow:rgba(79,128,105,.13);
--ce-on-sage:#FFFFFF;
--ce-rose:#B95146;
--ce-rose-deep:#923B33;
--ce-rose-glow:rgba(185,81,70,.11);
--ce-overlay:rgba(38,29,19,.48);
--ce-shadow:0 24px 70px rgba(61,43,23,.24),0 0 0 1px rgba(86,61,31,.06);
--ce-scheme:light;
}
body[data-theme="dark"] .crack-ext-ai-overlay,
body[data-theme="dark"] .crack-ext-ui-dialog-overlay,
body[data-theme="dark"] .crack-ext-toast,
html[data-theme="dark"] .crack-ext-ai-overlay,
html[data-theme="dark"] .crack-ext-ui-dialog-overlay,
html[data-theme="dark"] .crack-ext-toast,
html[data-sgb-theme="dark"] .crack-ext-ai-overlay,
html[data-sgb-theme="dark"] .crack-ext-ui-dialog-overlay,
html[data-sgb-theme="dark"] .crack-ext-toast{
--ce-bg:#14120F;
--ce-panel:#1D1A15;
--ce-panel-2:#211D17;
--ce-card:#262119;
--ce-card-hi:#2C2720;
--ce-line:#3B342A;
--ce-line-soft:#2E2921;
--ce-ink:#EDE5D6;
--ce-ink-dim:#A79B85;
--ce-ink-faint:#756B5C;
--ce-amber:#E2A84B;
--ce-amber-deep:#B87F2C;
--ce-amber-glow:rgba(226,168,75,.16);
--ce-sage:#8FB8A0;
--ce-sage-deep:#6E9A84;
--ce-sage-glow:rgba(143,184,160,.14);
--ce-on-sage:#102018;
--ce-rose:#D97B6C;
--ce-rose-deep:#B85D51;
--ce-rose-glow:rgba(217,123,108,.12);
--ce-overlay:rgba(5,4,3,.64);
--ce-shadow:0 24px 70px rgba(0,0,0,.5),0 0 0 1px rgba(0,0,0,.3);
--ce-scheme:dark;
}
.crack-ext-ai-overlay *,
.crack-ext-ai-overlay *::before,
.crack-ext-ai-overlay *::after,
.crack-ext-ui-dialog-overlay *,
.crack-ext-ui-dialog-overlay *::before,
.crack-ext-ui-dialog-overlay *::after{box-sizing:border-box}
.crack-ext-ai-overlay{background:var(--ce-overlay)!important;backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);padding:18px}
.crack-ext-ai-modal{
position:relative;
background:radial-gradient(ellipse 720px 320px at 76% -12%,var(--ce-amber-glow),transparent 64%),var(--ce-panel)!important;
color:var(--ce-ink)!important;
border:1px solid var(--ce-line)!important;
border-radius:14px!important;
padding:24px!important;
box-shadow:var(--ce-shadow)!important;
color-scheme:var(--ce-scheme);
scrollbar-color:var(--ce-line) transparent;
animation:ce-archive-in .26s ease both;
}
.crack-ext-ai-modal::selection,.crack-ext-ai-modal *::selection{background:var(--ce-amber-glow);color:var(--ce-ink)}
@keyframes ce-archive-in{from{opacity:0;transform:translateY(8px) scale(.995)}to{opacity:1;transform:none}}
.crack-ext-ai-modal-header{
position:relative;
isolation:isolate;
display:flex;
align-items:center;
justify-content:space-between;
gap:14px;
margin:-24px -24px 20px!important;
padding:20px 22px 18px!important;
border-bottom:1px solid var(--ce-line-soft);
background:linear-gradient(180deg,var(--ce-panel-2),var(--ce-panel));
overflow:hidden;
}
.crack-ext-ai-modal-header::after{
content:"";
position:absolute;
inset:0;
z-index:-1;
pointer-events:none;
background:var(--ce-amber);
opacity:.38;
-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 700 74' preserveAspectRatio='none'%3E%3Cpath d='M-10 58C120 30 190 64 300 42S520 18 710 40' fill='none' stroke='black' stroke-width='1.2'/%3E%3Ccircle cx='140' cy='44' r='2.6'/%3E%3Ccircle cx='300' cy='42' r='2.6'/%3E%3Ccircle cx='470' cy='30' r='2.6'/%3E%3Ccircle cx='620' cy='36' r='2.6'/%3E%3C/svg%3E") center/100% 100% no-repeat;
mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 700 74' preserveAspectRatio='none'%3E%3Cpath d='M-10 58C120 30 190 64 300 42S520 18 710 40' fill='none' stroke='black' stroke-width='1.2'/%3E%3Ccircle cx='140' cy='44' r='2.6'/%3E%3Ccircle cx='300' cy='42' r='2.6'/%3E%3Ccircle cx='470' cy='30' r='2.6'/%3E%3Ccircle cx='620' cy='36' r='2.6'/%3E%3C/svg%3E") center/100% 100% no-repeat;
transform-origin:left center;
animation:ce-thread-in 1.35s ease both .12s;
}
.crack-ext-compress-modal .crack-ext-ai-modal-header::after{background:var(--ce-sage)}
@keyframes ce-thread-in{from{opacity:0;transform:scaleX(.08)}to{opacity:.38;transform:scaleX(1)}}
.crack-ext-ai-modal-header h3{
position:relative;
z-index:1;
display:flex;
align-items:center;
gap:12px;
min-width:0;
margin:0!important;
color:var(--ce-ink)!important;
font-size:18px!important;
font-weight:700!important;
line-height:1.35;
}
.crack-ext-head-glyph{
display:grid;
place-items:center;
flex:0 0 auto;
width:36px;
height:36px;
border:1px solid color-mix(in srgb,var(--ce-amber) 34%,transparent);
border-radius:10px;
background:var(--ce-amber-glow);
color:var(--ce-amber);
font-size:17px;
line-height:1;
}
.crack-ext-head-glyph .crack-ext-ui-icon{width:19px;height:19px}
.crack-ext-compress-modal .crack-ext-head-glyph{border-color:color-mix(in srgb,var(--ce-sage) 38%,transparent);background:var(--ce-sage-glow);color:var(--ce-sage)}
.crack-ext-head-title{min-width:0}
.crack-ext-ai-modal-header-actions{position:relative;z-index:1}
#ce-editor-total{color:var(--ce-ink-faint)!important;font-variant-numeric:tabular-nums}
.crack-ext-ai-close-btn{
width:30px!important;
height:30px!important;
min-width:30px!important;
border-radius:8px!important;
background:transparent!important;
color:var(--ce-ink-faint)!important;
font-size:24px!important;
transition:color .2s,background .2s,transform .2s!important;
}
.crack-ext-ai-close-btn:hover{background:color-mix(in srgb,var(--ce-ink) 7%,transparent)!important;color:var(--ce-ink)!important;opacity:1!important;transform:rotate(90deg)}
.crack-ext-ai-close-btn:focus-visible,.crack-ext-ai-modal :focus-visible,.crack-ext-ui-dialog :focus-visible{outline:2px solid var(--ce-amber)!important;outline-offset:2px}
.crack-ext-ai-modal label{color:var(--ce-ink-dim)!important;font-size:11px!important;font-weight:650!important;letter-spacing:.055em;margin-bottom:6px!important}
.crack-ext-ai-modal input:not([type="checkbox"]),
.crack-ext-ai-modal textarea,
.crack-ext-ai-modal select,
.crack-ext-ui-dialog input{
background:var(--ce-bg)!important;
color:var(--ce-ink)!important;
border:1px solid var(--ce-line)!important;
border-radius:9px!important;
font-family:inherit!important;
font-size:13px!important;
transition:border-color .2s,box-shadow .2s,background .2s!important;
}
.crack-ext-ai-modal input:not([type="checkbox"]):focus,
.crack-ext-ai-modal textarea:focus,
.crack-ext-ai-modal select:focus,
.crack-ext-ui-dialog input:focus{outline:none!important;border-color:var(--ce-amber)!important;box-shadow:0 0 0 3px var(--ce-amber-glow)!important}
.crack-ext-ai-modal input::placeholder,.crack-ext-ai-modal textarea::placeholder,.crack-ext-ui-dialog input::placeholder{color:var(--ce-ink-faint)!important}
.crack-ext-ai-modal select option{background:var(--ce-bg)!important;color:var(--ce-ink)!important}
.crack-ext-ai-modal input[type="checkbox"]{accent-color:var(--ce-sage)}
.crack-ext-ai-modal input:disabled,.crack-ext-ai-modal textarea:disabled,.crack-ext-ai-modal select:disabled{opacity:.48!important;cursor:not-allowed}
#ce-ai-result{min-height:150px;resize:vertical;line-height:1.7;padding:14px!important}
#ce-ai-top-settings{display:grid;grid-template-columns:1.2fr 2fr 1.5fr .8fr;gap:12px;margin-bottom:12px}
#ce-ai-secondary-settings{display:grid;grid-template-columns:1fr 1fr 2fr;gap:12px;margin-bottom:18px}
#ce-ai-vertex-wrap{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(220px,1fr);gap:12px;margin:-2px 0 14px;padding:12px;border:1px solid var(--ce-line-soft);border-radius:11px;background:var(--ce-panel-2)}
#ce-ai-vertex-json{min-height:104px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Consolas,monospace!important;font-size:11px!important;line-height:1.45}
.crack-ext-vertex-credential-actions{display:flex;align-items:center;gap:7px;margin-top:7px;flex-wrap:wrap}
.crack-ext-vertex-status{flex:1 1 120px;color:var(--ce-ink-faint);font-size:10.5px;line-height:1.4}
.crack-ext-vertex-status.is-saved{color:var(--ce-sage)}
.crack-ext-vertex-status.is-error{color:var(--ce-rose)}
.crack-ext-vertex-small-btn{padding:5px 9px!important;font-size:10.5px!important}
.crack-ext-vertex-meta{display:grid;grid-template-columns:1fr;gap:10px;align-content:start}
.crack-ext-vertex-note{grid-column:1/-1;margin-top:-3px;color:var(--ce-ink-faint);font-size:10.5px;line-height:1.5;word-break:keep-all}
/* ── 턴 수 안내 ───────────────────────────── */
.crack-ext-turn-field{
position:relative;
}

.crack-ext-turn-field .crack-ext-turn-label{
display:flex!important;
align-items:center!important;
justify-content:flex-start!important;
gap:5px!important;
width:max-content;
}

.crack-ext-turn-info-btn{
display:inline-flex!important;
align-items:center!important;
justify-content:center!important;
flex:0 0 auto!important;
width:17px!important;
height:17px!important;
min-width:17px!important;
padding:0!important;
margin:0!important;
border:0!important;
border-radius:50%!important;
background:transparent!important;
color:var(--ce-ink-faint)!important;
cursor:pointer;
box-shadow:none!important;
transition:color .18s,background .18s,transform .18s!important;
}

.crack-ext-turn-info-btn .crack-ext-ui-icon{
width:13px!important;
height:13px!important;
}

.crack-ext-turn-info-btn:hover,
.crack-ext-turn-info-btn[aria-expanded="true"]{
color:var(--ce-amber)!important;
background:var(--ce-amber-glow)!important;
}

.crack-ext-turn-info-btn:active{
transform:scale(.92);
}

.crack-ext-turn-info-popover{
position:absolute;
z-index:50;
top:calc(100% + 7px);
right:0;
width:max-content;
max-width:290px;
padding:10px 12px;
border:1px solid var(--ce-line);
border-radius:9px;
background:var(--ce-panel);
color:var(--ce-ink-dim);
box-shadow:0 8px 24px color-mix(in srgb,var(--ce-ink) 16%,transparent);
font-size:11px;
font-weight:500;
line-height:1.55;
letter-spacing:0;
}

.crack-ext-turn-info-popover[hidden]{
display:none!important;
}

.crack-ext-turn-info-popover::before{
content:"";
position:absolute;
top:-5px;
right:12px;
width:8px;
height:8px;
background:var(--ce-panel);
border-left:1px solid var(--ce-line);
border-top:1px solid var(--ce-line);
transform:rotate(45deg);
}

.crack-ext-turn-info-popover strong{
display:block;
color:var(--ce-ink);
font-size:11px;
font-weight:700;
white-space:nowrap;
}

.crack-ext-turn-info-popover span{
display:block;
margin-top:2px;
white-space:nowrap;
}

.crack-ext-turn-info-popover b{
color:var(--ce-amber);
font-weight:750;
}

@media(max-width:520px){
.crack-ext-turn-info-popover{
right:auto;
left:0;
width:max-content;
max-width:min(290px,calc(100vw - 50px));
}
.crack-ext-turn-info-popover::before{
right:auto;
left:39px;
}
.crack-ext-turn-info-popover strong,
.crack-ext-turn-info-popover span{
white-space:normal;
}
}
#ce-ai-top-settings .fg,#ce-ai-secondary-settings .fg{min-width:0!important}
.crack-ext-ai-modal-btns{
display:flex;
align-items:center;
justify-content:space-between;
gap:10px;
flex-wrap:wrap;
margin:18px -24px -24px!important;
padding:16px 22px!important;
border-top:1px solid var(--ce-line-soft);
background:var(--ce-panel-2)!important;
}
.crack-ext-editor-modal .crack-ext-ai-modal-btns{position:sticky!important;bottom:-24px!important;z-index:20!important}
.crack-ext-ai-footer-right{gap:8px}
.crack-ext-ai-mbtn,
.crack-ext-export-btn,
#ce-ai-card-nav button{
border:1px solid var(--ce-line)!important;
background:var(--ce-card)!important;
color:var(--ce-ink)!important;
border-radius:9px!important;
font-family:inherit!important;
font-weight:650!important;
box-shadow:none!important;
transition:transform .15s ease,box-shadow .2s,border-color .2s,background .2s,color .2s!important;
}
.crack-ext-ai-mbtn{display:inline-flex;align-items:center;justify-content:center;gap:7px}
.crack-ext-ui-icon{display:block;flex:0 0 auto;width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
.crack-ext-ai-close-btn .crack-ext-ui-icon{width:16px;height:16px}
.crack-ext-compress-note .crack-ext-ui-icon{width:16px;height:16px;margin-top:2px}
.crack-ext-ai-mbtn:hover,.crack-ext-export-btn:hover,#ce-ai-card-nav button:hover{background:var(--ce-card-hi)!important;border-color:var(--ce-ink-faint)!important;transform:translateY(-1px)}
.crack-ext-ai-mbtn:active,.crack-ext-export-btn:active,#ce-ai-card-nav button:active{transform:translateY(0)}
.crack-ext-ai-mbtn-p:not(:disabled),#ce-ai-generate:not(:disabled),#ce-editor-save:not(:disabled){
background:linear-gradient(160deg,var(--ce-amber),var(--ce-amber-deep))!important;
color:#1B150A!important;
border-color:transparent!important;
box-shadow:0 3px 14px var(--ce-amber-glow)!important;
}
.crack-ext-ai-mbtn-p:not(:disabled):hover,#ce-ai-generate:not(:disabled):hover,#ce-editor-save:not(:disabled):hover{box-shadow:0 5px 22px var(--ce-amber-glow)!important}
#ce-ai-compress-btn:not(:disabled){background:var(--ce-sage-glow)!important;color:var(--ce-sage)!important;border-color:color-mix(in srgb,var(--ce-sage) 42%,transparent)!important}
#ce-compress-start:not(:disabled){background:linear-gradient(160deg,var(--ce-sage),var(--ce-sage-deep))!important;color:var(--ce-on-sage)!important;border-color:transparent!important;box-shadow:0 3px 14px var(--ce-sage-glow)!important}
#ce-compress-back,#ce-editor-back,#ce-ai-prompt-back{background:transparent!important;border-color:transparent!important;color:var(--ce-ink-dim)!important}
#ce-compress-back:hover,#ce-editor-back:hover,#ce-ai-prompt-back:hover{background:color-mix(in srgb,var(--ce-ink) 6%,transparent)!important;color:var(--ce-ink)!important}
.crack-ext-editor-danger,.crack-ext-prompt-icon-btn.is-delete{background:transparent!important;color:var(--ce-rose)!important;border-color:color-mix(in srgb,var(--ce-rose) 48%,transparent)!important}
.crack-ext-editor-danger:hover,.crack-ext-prompt-icon-btn.is-delete:hover{background:var(--ce-rose-glow)!important;color:var(--ce-rose-deep)!important}
.crack-ext-ai-mbtn-save{background:var(--ce-sage)!important;color:#102018!important;border-color:transparent!important}
.crack-ext-ai-mbtn:disabled,.crack-ext-ai-mbtn-p:disabled,.crack-ext-export-btn:disabled{background:var(--ce-line-soft)!important;color:var(--ce-ink-faint)!important;border-color:var(--ce-line-soft)!important;box-shadow:none!important;cursor:not-allowed;transform:none;opacity:.68}
#ce-ai-generate:disabled{position:relative;overflow:hidden}
#ce-ai-generate:disabled::after{content:"";position:absolute;inset:0;background:linear-gradient(110deg,transparent 30%,color-mix(in srgb,var(--ce-ink) 22%,transparent) 50%,transparent 70%);animation:ce-shimmer 1.35s linear infinite}
@keyframes ce-shimmer{from{transform:translateX(-100%)}to{transform:translateX(100%)}}
.crack-ext-export-actions{gap:6px}
.crack-ext-export-btn{padding:7px 13px;border-radius:999px!important;background:transparent!important;color:var(--ce-ink-dim)!important}
.crack-ext-export-btn:hover{color:var(--ce-amber)!important;border-color:var(--ce-amber-deep)!important}
.crack-ext-prompt-header{margin-bottom:8px;gap:12px}
.crack-ext-prompt-heading-main{display:inline-flex;align-items:center;gap:9px;color:var(--ce-ink)!important;font-size:15px;font-weight:700}
.crack-ext-prompt-heading-main::before{content:"";width:7px;height:7px;flex:0 0 auto;border-radius:50%;background:var(--ce-amber);box-shadow:0 0 8px var(--ce-amber);animation:ce-pulse 2.4s ease-in-out infinite}
@keyframes ce-pulse{0%,100%{opacity:.48}50%{opacity:1}}
.crack-ext-reasoning-usage{color:var(--ce-ink-faint)!important;font-weight:500;font-variant-numeric:tabular-nums}
.crack-ext-prompt-heading-sub,.crack-ext-prompt-field-label{color:var(--ce-ink-faint)!important}
.crack-ext-prompt-header.is-editing{border-color:var(--ce-line)!important;border-radius:10px;background:var(--ce-card)!important;padding:11px 12px}
.crack-ext-prompt-header.is-editing .crack-ext-prompt-heading-main::before{background:var(--ce-sage);box-shadow:0 0 8px var(--ce-sage)}
.crack-ext-prompt-field select{background-color:var(--ce-bg)!important}
.crack-ext-prompt-icon-btn.is-save{background:linear-gradient(160deg,var(--ce-amber),var(--ce-amber-deep))!important;color:#1B150A!important;border-color:transparent!important}
#ce-ai-selection-counter{color:var(--ce-sage)!important;font-weight:650}
#ce-ai-preview-container{margin-top:14px}
#ce-ai-card-nav{gap:14px;margin:10px 0 8px;color:var(--ce-ink-dim)!important;font-weight:600}
#ce-ai-card-nav button{padding:5px 11px;font-size:11px}
.crack-ext-session-card{
position:relative;
overflow:hidden;
margin-bottom:8px;
padding:14px 16px 12px 22px!important;
background:var(--ce-card)!important;
border:1px solid var(--ce-line)!important;
border-radius:9px!important;
transition:transform .2s ease,box-shadow .25s ease!important;
}
.crack-ext-session-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,var(--ce-amber),var(--ce-amber-deep))}
.crack-ext-session-card::after{content:"";position:absolute;left:9px;top:14px;width:5px;height:5px;border-radius:50%;background:var(--ce-bg);border:1px solid var(--ce-line)}
.crack-ext-session-card:hover{transform:translateY(-2px);box-shadow:0 8px 24px color-mix(in srgb,var(--ce-ink) 14%,transparent)}
.crack-ext-session-title{color:var(--ce-amber)!important;font-size:14px;line-height:1.45}
.crack-ext-session-content{color:var(--ce-ink-dim)!important;line-height:1.75!important}
.crack-ext-char-count{color:var(--ce-ink-faint)!important;font-variant-numeric:tabular-nums}
.crack-ext-count-error{color:var(--ce-rose)!important}
.crack-ext-badge{border-radius:999px;padding:4px 10px;margin-left:6px;vertical-align:middle;letter-spacing:.02em}
.crack-ext-badge-compress{background:var(--ce-sage-glow)!important;color:var(--ce-sage)!important;border:1px solid color-mix(in srgb,var(--ce-sage) 34%,transparent)}
.crack-ext-compress-header{margin-bottom:9px;gap:10px}
.crack-ext-compress-header span{color:var(--ce-ink-dim)!important;font-size:12px}
.crack-ext-compress-list{max-height:300px;padding:0;background:var(--ce-bg);border:1px solid var(--ce-line);border-radius:9px;overflow-y:auto;scrollbar-color:var(--ce-line) transparent}
.crack-ext-compress-list>div[style]{color:var(--ce-ink-faint)!important}
.crack-ext-compress-item{position:relative;gap:12px;padding:12px 14px;border-bottom:1px solid var(--ce-line-soft);font-size:12px;transition:background .18s}
.crack-ext-compress-item:last-child{border-bottom:0}
.crack-ext-compress-item:hover{background:color-mix(in srgb,var(--ce-ink) 4%,transparent)}
.crack-ext-compress-item:has(input:checked){background:var(--ce-sage-glow)}
.crack-ext-compress-item:has(input:checked)::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--ce-sage)}
.crack-ext-compress-item input[type="checkbox"]{width:17px!important;height:17px!important;margin-top:2px!important;accent-color:var(--ce-sage)}
.crack-ext-compress-item .item-title{color:var(--ce-ink)!important;font-size:13px;font-weight:650}
.crack-ext-compress-item .item-summary{max-width:500px;color:var(--ce-ink-faint)!important;font-size:11.5px;margin-top:2px}
.crack-ext-compress-note{display:flex;align-items:flex-start;gap:8px;padding:11px 14px;margin-top:14px!important;border:1px solid color-mix(in srgb,var(--ce-sage) 30%,transparent);border-radius:9px;background:var(--ce-sage-glow);color:var(--ce-sage)!important;line-height:1.6}
.crack-ext-editor-modal{width:1040px!important}
.crack-ext-editor-toolbar{position:sticky;top:-24px;z-index:15;padding:0 0 14px;margin-bottom:16px;background:var(--ce-panel)!important;border-color:var(--ce-line-soft)!important}
.crack-ext-editor-search-row{gap:10px}
.crack-ext-editor-search-row input{min-width:220px;padding-left:12px!important}
.crack-ext-editor-check-label{color:var(--ce-ink-dim)!important;font-size:12px!important;letter-spacing:0!important}
.crack-ext-editor-check-label input[type="checkbox"]{accent-color:var(--ce-sage)}
#ce-editor-summary{color:var(--ce-ink-faint)!important;font-variant-numeric:tabular-nums}
.crack-ext-editor-list{gap:14px}
.crack-ext-editor-card{
position:relative;
overflow:hidden;
padding:0;
background:var(--ce-card)!important;
border:1px solid var(--ce-line)!important;
border-radius:14px;
box-shadow:none;
transition:border-color .25s,box-shadow .25s,opacity .25s;
}
.crack-ext-editor-card.is-selected{border-color:var(--ce-sage)!important;box-shadow:0 0 0 2px var(--ce-sage-glow)!important}
.crack-ext-editor-card.is-changed{border-color:color-mix(in srgb,var(--ce-amber) 55%,var(--ce-line))!important;box-shadow:0 0 0 1px var(--ce-amber-glow)!important}
.crack-ext-editor-card.is-delete{border-color:color-mix(in srgb,var(--ce-rose) 58%,var(--ce-line))!important;background:var(--ce-card)!important;opacity:.78}
.crack-ext-editor-card.is-error{border-color:var(--ce-rose)!important;box-shadow:0 0 0 2px var(--ce-rose-glow)!important}
.crack-ext-editor-card-head{margin:0;padding:11px 16px;border-bottom:1px solid var(--ce-line-soft);background:color-mix(in srgb,var(--ce-ink) 2.5%,transparent)}
.crack-ext-editor-card-title{gap:12px}
.crack-ext-editor-index{display:flex;align-items:center;gap:8px;color:var(--ce-ink-faint)!important;font-variant-numeric:tabular-nums}
.crack-ext-editor-status{display:inline-flex;padding:3px 9px;border-radius:999px;background:color-mix(in srgb,var(--ce-ink) 5%,transparent);color:var(--ce-ink-faint);font-size:10px;line-height:1.35;letter-spacing:.035em}
.crack-ext-editor-card.is-changed .crack-ext-editor-status{background:var(--ce-amber-glow);color:var(--ce-amber)}
.crack-ext-editor-card.is-delete .crack-ext-editor-status{background:var(--ce-rose-glow);color:var(--ce-rose)}
.crack-ext-editor-grid{grid-template-columns:1fr 1fr;gap:0}
.crack-ext-editor-pane{padding:14px 16px;background:transparent!important;border:0!important;border-radius:0}
.crack-ext-editor-pane+.crack-ext-editor-pane{border-left:1px dashed var(--ce-line-soft)!important}
.crack-ext-editor-pane h4{display:flex;align-items:center;gap:6px;margin:0 0 9px;color:var(--ce-ink-faint)!important;font-size:10px;letter-spacing:.12em}
.crack-ext-editor-pane h4::after{content:"";flex:1;height:1px;background:var(--ce-line-soft)}
.crack-ext-editor-original{color:var(--ce-ink-dim)!important;line-height:1.75;font-size:12px}
.crack-ext-editor-original strong{display:block;margin-bottom:5px;color:var(--ce-ink)!important;font-size:13px}
.crack-ext-editor-title-input{margin-bottom:9px!important;font-weight:700}
.crack-ext-editor-summary-input{min-height:112px;line-height:1.7}
.crack-ext-editor-meta{color:var(--ce-ink-faint)!important;font-variant-numeric:tabular-nums}
.crack-ext-editor-meta span:last-child:not(:empty){color:var(--ce-rose)!important;font-weight:650}
.crack-ext-editor-empty{color:var(--ce-ink-faint)!important}
.crack-ext-ui-dialog-overlay{background:var(--ce-overlay)!important;backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}
.crack-ext-ui-dialog{background:var(--ce-panel)!important;color:var(--ce-ink)!important;border:1px solid var(--ce-line);border-radius:14px;padding:20px;box-shadow:var(--ce-shadow);color-scheme:var(--ce-scheme)}
.crack-ext-ui-dialog::before{height:3px;background:var(--ce-amber)!important}
.crack-ext-ui-dialog.is-danger::before{background:var(--ce-rose)!important}
.crack-ext-ui-dialog.is-warning::before{background:var(--ce-amber)!important}
.crack-ext-ui-dialog.is-success::before{background:var(--ce-sage)!important}
.crack-ext-ui-dialog h4{color:var(--ce-ink)!important;font-size:15px}
.crack-ext-ui-dialog p{color:var(--ce-ink-dim)!important;line-height:1.65}
.crack-ext-ui-dialog-error{color:var(--ce-rose)!important}
.crack-ext-toast{background:var(--ce-panel)!important;color:var(--ce-ink)!important;border:1px solid var(--ce-line)!important;border-left:3px solid var(--ce-amber)!important;border-radius:10px;box-shadow:0 8px 28px color-mix(in srgb,var(--ce-ink) 18%,transparent)!important}
.crack-ext-header-ai-btn{color:#6E5F4C!important}
.crack-ext-header-ai-btn .crack-ext-header-ai-icon{color:#9D6D2B!important}
.crack-ext-header-ai-btn:hover{background:rgba(182,120,34,.09)!important;border-color:rgba(182,120,34,.15)!important;color:#8F5B18!important}
body[data-theme="dark"] .crack-ext-header-ai-btn,html[data-theme="dark"] .crack-ext-header-ai-btn,html[data-sgb-theme="dark"] .crack-ext-header-ai-btn{color:#C9BBA5!important}
body[data-theme="dark"] .crack-ext-header-ai-btn .crack-ext-header-ai-icon,html[data-theme="dark"] .crack-ext-header-ai-btn .crack-ext-header-ai-icon,html[data-sgb-theme="dark"] .crack-ext-header-ai-btn .crack-ext-header-ai-icon{color:#D5A052!important}
body[data-theme="dark"] .crack-ext-header-ai-btn:hover,html[data-theme="dark"] .crack-ext-header-ai-btn:hover,html[data-sgb-theme="dark"] .crack-ext-header-ai-btn:hover{background:rgba(226,168,75,.1)!important;border-color:rgba(226,168,75,.16)!important;color:#EDE5D6!important}
body[data-theme="dark"] .crack-ext-header-ai-btn.crack-ext-floating,html[data-theme="dark"] .crack-ext-header-ai-btn.crack-ext-floating,html[data-sgb-theme="dark"] .crack-ext-header-ai-btn.crack-ext-floating,body[data-theme="dark"] .crack-ext-header-ai-btn.crack-ext-header-fallback,html[data-theme="dark"] .crack-ext-header-ai-btn.crack-ext-header-fallback,html[data-sgb-theme="dark"] .crack-ext-header-ai-btn.crack-ext-header-fallback{background:rgba(39,35,30,.96)!important;border-color:rgba(213,160,82,.34)!important;color:#EDE5D6!important;box-shadow:0 7px 24px rgba(0,0,0,.38)!important}
@media(max-width:820px){
#ce-ai-top-settings{
grid-template-columns:minmax(0,1fr) minmax(0,1.15fr) minmax(58px,.62fr);
gap:8px;
align-items:end;
margin-bottom:10px;
}
#ce-ai-top-settings .ce-ai-provider-field{grid-column:1;grid-row:1}
#ce-ai-top-settings .ce-ai-model-field{grid-column:2;grid-row:1}
#ce-ai-top-settings .crack-ext-turn-field{grid-column:3;grid-row:1}
#ce-ai-key-wrap,#ce-ai-firebase-wrap{grid-column:1/-1;grid-row:2}
#ce-ai-secondary-settings{
grid-template-columns:minmax(0,.75fr) minmax(0,.75fr) minmax(134px,1.5fr);
gap:8px;
align-items:start;
margin-bottom:12px;
}
#ce-ai-secondary-settings .crack-ext-export-actions{gap:4px;flex-wrap:nowrap}
#ce-ai-secondary-settings .crack-ext-export-btn{min-width:0;padding:7px 9px}
#ce-ai-secondary-settings label{white-space:nowrap}
#ce-ai-top-settings .crack-ext-turn-info-popover{left:auto;right:0;max-width:min(290px,calc(100vw - 32px))}
#ce-ai-top-settings .crack-ext-turn-info-popover::before{left:auto;right:12px}
#ce-ai-vertex-wrap{grid-template-columns:1fr}
.crack-ext-vertex-meta{grid-template-columns:1fr 1fr}
.crack-ext-editor-grid{grid-template-columns:1fr}
.crack-ext-editor-pane+.crack-ext-editor-pane{border-left:0!important;border-top:1px dashed var(--ce-line-soft)!important}
}
@media(max-width:760px){
.crack-ext-ai-overlay{padding:8px}
.crack-ext-ai-modal{width:calc(100vw - 16px)!important;max-width:none!important;max-height:calc(100vh - 16px)!important;max-height:calc(100dvh - 16px)!important;padding:16px!important}
.crack-ext-ai-modal-header{position:sticky;top:-16px;z-index:20;margin:-16px -16px 16px!important;padding:16px 16px 14px!important}
.crack-ext-ai-modal-btns{position:sticky!important;bottom:-16px!important;z-index:20!important;margin:16px -16px -16px!important;padding:14px 16px!important}
.crack-ext-editor-modal .crack-ext-ai-modal-btns{bottom:-16px!important}
.crack-ext-editor-toolbar{top:27px;padding-top:8px}
.crack-ext-editor-search-row input{min-width:100%}
.crack-ext-compress-list{max-height:44vh;max-height:44dvh}
.crack-ext-prompt-header{align-items:flex-start}
}
@media(max-width:520px){
.crack-ext-ai-modal-btns{flex-direction:column;align-items:stretch}
#ce-ai-main-actions,.crack-ext-ai-footer-right{width:100%}
#ce-ai-main-actions .crack-ext-ai-mbtn,.crack-ext-ai-footer-right .crack-ext-ai-mbtn{flex:1 1 auto;justify-content:center}
.crack-ext-ai-modal-header h3{font-size:16px!important;gap:9px}
.crack-ext-head-glyph{width:34px;height:34px;border-radius:9px;font-size:16px}
.crack-ext-badge{display:inline-flex;margin:5px 0 0}
}
@media(max-width:430px){
.crack-ext-ai-modal{padding:14px!important;max-height:calc(100vh - 16px)!important;max-height:calc(100dvh - 16px)!important}
.crack-ext-ai-modal-header{top:-14px;margin:-14px -14px 14px!important;padding:14px!important}
.crack-ext-ai-modal-btns{bottom:-14px!important;margin:14px -14px -14px!important;padding:12px 14px!important}
.crack-ext-editor-modal .crack-ext-ai-modal-btns{bottom:-14px!important}
.crack-ext-editor-card-head{align-items:stretch!important;flex-direction:column;padding:10px 12px}
.crack-ext-editor-pane{padding:12px}
.crack-ext-editor-actions{justify-content:stretch;width:100%}
.crack-ext-editor-actions .crack-ext-ai-mbtn{flex:1 1 0}
.crack-ext-editor-meta{flex-wrap:wrap}
#ce-ai-top-settings{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
#ce-ai-top-settings .ce-ai-provider-field{grid-column:1;grid-row:1}
#ce-ai-top-settings .ce-ai-model-field{grid-column:2;grid-row:1}
#ce-ai-top-settings .crack-ext-turn-field{grid-column:1;grid-row:2}
#ce-ai-key-wrap,#ce-ai-firebase-wrap{grid-column:1/-1;grid-row:3}
#ce-ai-secondary-settings{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
#ce-ai-secondary-settings .fg:nth-child(3){grid-column:1/-1}
#ce-ai-secondary-settings .crack-ext-export-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));width:100%}
#ce-ai-secondary-settings .crack-ext-export-btn{padding:6px 5px;font-size:11px}
.crack-ext-auto-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
.crack-ext-auto-grid .crack-ext-auto-field:last-child{grid-column:1/-1}
}
@media(max-width:760px),(pointer:coarse){
.crack-ext-header-ai-btn:not(.crack-ext-floating){width:44px!important;min-width:44px!important;height:44px!important;padding:0!important;border-radius:9px!important;touch-action:manipulation}
.crack-ext-header-ai-btn:not(.crack-ext-floating) span{display:none}
.crack-ext-header-ai-btn:not(.crack-ext-floating) .crack-ext-header-ai-icon{width:18px;height:18px}
.crack-ext-ai-modal input:not([type="checkbox"]),.crack-ext-ai-modal textarea,.crack-ext-ai-modal select,.crack-ext-ui-dialog input{font-size:16px!important;min-height:44px}
#ce-ai-vertex-json{font-size:16px!important}
.crack-ext-ai-mbtn,.crack-ext-export-btn,#ce-ai-card-nav button{min-height:44px;touch-action:manipulation}
.crack-ext-ai-close-btn,.crack-ext-prompt-icon-btn{width:44px!important;height:44px!important;min-width:44px!important;touch-action:manipulation}
.crack-ext-turn-info-btn{width:32px!important;height:32px!important;min-width:32px!important;margin:0!important;position:relative}
.crack-ext-turn-info-btn::after{content:"";position:absolute;inset:-6px}
.crack-ext-vertex-small-btn{font-size:13px!important}
.crack-ext-auto-field input[type="number"]{height:44px!important}
.crack-ext-auto-check,.crack-ext-editor-check-label{min-height:44px!important}
.crack-ext-ai-modal .crack-ext-auto-check,.crack-ext-ai-modal .crack-ext-editor-check-label{font-size:14px!important;letter-spacing:0!important}
.crack-ext-ai-modal{overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scroll-padding:64px 0 112px}
.crack-ext-ai-overlay,.crack-ext-ui-dialog-overlay{overscroll-behavior:contain}
}
@media(max-width:760px){
.crack-ext-ai-overlay{padding:calc(8px + env(safe-area-inset-top,0px)) calc(8px + env(safe-area-inset-right,0px)) calc(8px + env(safe-area-inset-bottom,0px)) calc(8px + env(safe-area-inset-left,0px))}
.crack-ext-ai-modal{width:100%!important;max-height:100%!important}
.crack-ext-editor-toolbar{top:60px}
}
@media(max-width:430px){
#ce-ai-top-settings .crack-ext-turn-info-popover{left:0;right:auto;max-width:min(290px,calc(100vw - 50px))}
#ce-ai-top-settings .crack-ext-turn-info-popover::before{left:39px;right:auto}
}
@media(max-width:430px){.crack-ext-editor-toolbar{position:static!important;top:auto!important;padding-top:0}}
/* 모바일 가로 화면: 편집 툴바가 카드 조작 영역을 덮지 않도록 일반 스크롤로 전환 */
@media (max-height:520px) and (max-width:760px){
.crack-ext-editor-toolbar{position:static!important;top:auto!important;padding-top:0}
.crack-ext-ai-modal-btns,.crack-ext-editor-modal .crack-ext-ai-modal-btns{position:static!important;bottom:auto!important}
}
@media (pointer:coarse) and (max-height:520px){
.crack-ext-ai-overlay{padding:calc(8px + env(safe-area-inset-top,0px)) calc(8px + env(safe-area-inset-right,0px)) calc(8px + env(safe-area-inset-bottom,0px)) calc(8px + env(safe-area-inset-left,0px))}
.crack-ext-ai-modal{width:100%!important;max-width:100%!important;max-height:100%!important;overflow-x:hidden;overscroll-behavior:contain}
.crack-ext-editor-toolbar,.crack-ext-ai-modal-btns,.crack-ext-editor-modal .crack-ext-ai-modal-btns{position:static!important;top:auto!important;bottom:auto!important}
}
/* 768px 태블릿에서도 스크롤 중 닫기 버튼을 유지 */
@media (min-width:761px) and (max-width:820px){
.crack-ext-ai-modal-header{position:sticky;top:-24px;z-index:20}
.crack-ext-editor-toolbar{position:static!important;top:auto!important}
}
@media(prefers-reduced-motion:reduce){
.crack-ext-ai-modal,.crack-ext-ai-modal-header::after,.crack-ext-prompt-heading-main::before,#ce-ai-generate:disabled::after{animation:none!important;transition:none!important}
}
`;
        document.head.appendChild(s);
    }

    function showThemedDialog(options) {
        options = options || {};
        return new Promise(function(resolve) {
            var dialogOverlay = document.createElement('div');
            dialogOverlay.className = 'crack-ext-ui-dialog-overlay';
            var hasInput = Object.prototype.hasOwnProperty.call(options, 'inputValue');
            var cancelButton = options.hideCancel ? '' : '<button type="button" class="crack-ext-ai-mbtn" data-dialog-cancel>' + escapeHtml(options.cancelText || '취소') + '</button>';
            var toneClass = options.danger || options.tone === 'danger' ? ' is-danger' : options.tone === 'warning' ? ' is-warning' : options.tone === 'success' ? ' is-success' : '';
            dialogOverlay.innerHTML = '<div class="crack-ext-ui-dialog' + toneClass + '" role="dialog" aria-modal="true" aria-labelledby="crack-ext-ui-dialog-title">' +
                '<h4 id="crack-ext-ui-dialog-title">' + escapeHtml(options.title || '확인') + '</h4>' +
                (options.message ? '<p class="crack-ext-ui-dialog-message">' + escapeHtml(options.message) + '</p>' : '') +
                (hasInput ? '<input type="text" maxlength="' + (options.maxLength || 30) + '" value="' + escapeHtml(options.inputValue || '') + '" placeholder="' + escapeHtml(options.placeholder || '') + '"><div class="crack-ext-ui-dialog-error"></div>' : '') +
                '<div class="crack-ext-ui-dialog-actions">' + cancelButton + '<button type="button" class="crack-ext-ai-mbtn ' + (options.danger ? 'crack-ext-editor-danger' : 'crack-ext-ai-mbtn-p') + '" data-dialog-confirm>' + escapeHtml(options.confirmText || '확인') + '</button></div>' +
                '</div>';
            document.body.appendChild(dialogOverlay);

            var input = dialogOverlay.querySelector('input');
            var errorEl = dialogOverlay.querySelector('.crack-ext-ui-dialog-error');
            var confirmBtn = dialogOverlay.querySelector('[data-dialog-confirm]');
            var cancelBtn = dialogOverlay.querySelector('[data-dialog-cancel]');
            var settled = false;

            function finish(confirmed) {
                if (settled) return;
                if (confirmed && hasInput) {
                    var value = input.value.trim();
                    if (options.required !== false && !value) {
                        if (errorEl) errorEl.textContent = options.emptyMessage || '이름을 입력해주세요.';
                        input.focus();
                        return;
                    }
                }
                settled = true;
                var valueOut = hasInput ? input.value.trim() : '';
                dialogOverlay.remove();
                resolve({ confirmed: confirmed, value: valueOut });
            }

            confirmBtn.onclick = function() { finish(true); };
            if (cancelBtn) cancelBtn.onclick = function() { finish(false); };
            dialogOverlay.addEventListener('click', function(e) { if (e.target === dialogOverlay && !options.preventBackdropClose) finish(false); });
            dialogOverlay.addEventListener('keydown', function(e) {
                if (e.key === 'Escape' && !options.hideCancel) { e.preventDefault(); finish(false); }
                if (e.key === 'Enter' && hasInput && !e.shiftKey) { e.preventDefault(); finish(true); }
            });
            requestAnimationFrame(function() {
                if (input) { input.focus(); input.select(); }
                else confirmBtn.focus();
            });
        });
    }

    function showUiAlert(message, title, options) {
        options = options || {};
        return showThemedDialog({
            title: title || '알림',
            message: message || '',
            confirmText: options.confirmText || '확인',
            hideCancel: true,
            tone: options.tone || (options.danger ? 'danger' : '')
        });
    }

    async function showUiConfirm(message, title, options) {
        options = options || {};
        var result = await showThemedDialog({
            title: title || '확인',
            message: message || '',
            confirmText: options.confirmText || '확인',
            cancelText: options.cancelText || '취소',
            danger: !!options.danger,
            tone: options.tone || (options.danger ? 'danger' : ''),
            preventBackdropClose: !!options.preventBackdropClose
        });
        return !!result.confirmed;
    }

    function showToast(message) {
        var old = document.getElementById('crack-ext-toast');
        if (old) old.remove();
        var toast = document.createElement('div');
        toast.id = 'crack-ext-toast';
        toast.className = 'crack-ext-toast';
        toast.style.opacity = '0';
        toast.textContent = message;
        document.body.appendChild(toast);
        requestAnimationFrame(function() { toast.style.opacity = '1'; toast.style.transform = 'translateX(-50%) translateY(0)'; });
        setTimeout(function() { toast.style.opacity = '0'; toast.style.transform = 'translateX(-50%) translateY(-10px)'; setTimeout(function() { if (toast.isConnected) toast.remove(); }, 300); }, 3000);
    }

    function refreshCurrentTab(dialog) {
        var btns = dialog.querySelectorAll('button'), activeBtn = null, otherBtn = null;
        for (var i = 0; i < btns.length; i++) {
            var txt = btns[i].textContent.trim();
            if (txt === '단기 기억' || txt === '장기 기억') {
                var bg = getComputedStyle(btns[i]).backgroundColor;
                var m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)\)/);
                if (m && (parseInt(m[1]) + parseInt(m[2]) + parseInt(m[3])) / 3 < 128) activeBtn = btns[i];
                else if (txt === '장기 기억') otherBtn = btns[i];
            }
        }
        if (!activeBtn) return;
        if (otherBtn) { otherBtn.click(); setTimeout(() => { activeBtn.click(); }, 150); }
        else { activeBtn.click(); }
    }

    function updateModelOptions(provider) {
        var sel = document.getElementById('ce-ai-model');
        if (!sel) return;
        var modelStorageKey = 'crack_ext_' + provider + '_model';
        var savedModel = localStorage.getItem(modelStorageKey) || '';
        if ((provider === 'google' || provider === 'firebase' || provider === 'vertex') && savedModel === 'gemini-3-pro-preview') {
            savedModel = 'gemini-3.1-pro-preview';
            localStorage.setItem(modelStorageKey, savedModel);
        }
        sel.innerHTML = '';
        var models = [];
        if (provider === 'google' || provider === 'vertex') {
            models = [
                {v:'gemini-3.6-flash', t:'3.6 Flash'},
                {v:'gemini-3.5-flash', t:'3.5 Flash'},
                {v:'gemini-3.1-pro-preview', t:'3.1 Pro'},
                {v:'gemini-3.1-flash-lite', t:'3.1 Flash-Lite'},
                {v:'gemini-3-flash-preview', t:'3.0 Flash'},
                {v:'gemini-2.5-pro', t:'2.5 Pro'},
                {v:'gemini-2.5-flash', t:'2.5 Flash'},
                {v:'gemini-2.5-flash-lite', t:'2.5 Flash-Lite'}
            ];
        } else if (provider === 'deepseek') {
            models = [
                {v:'deepseek-v4-pro', t:'V4 Pro'},
                {v:'deepseek-v4-flash', t:'V4 Flash'}
            ];
        } else if (provider === 'firebase') {
            models = [
                {v:'gemini-3.6-flash', t:'3.6 Flash'},
                {v:'gemini-3.1-pro-preview', t:'3.1 Pro'},
                {v:'gemini-3.5-flash', t:'3.5 Flash'},
                {v:'gemini-3.1-flash-lite', t:'3.1 Flash-Lite'},
                {v:'gemini-2.5-pro', t:'2.5 Pro'},
                {v:'gemini-2.5-flash', t:'2.5 Flash'},
                {v:'gemini-2.5-flash-lite', t:'2.5 Flash-Lite'}
            ];
        } else if (provider === 'openai') {
            models = [
                {v:'gpt-5.6-sol', t:'GPT-5.6 Sol'},
                {v:'gpt-5.6-terra', t:'GPT-5.6 Terra'},
                {v:'gpt-5.6-luna', t:'GPT-5.6 Luna'},
                {v:'gpt-5.4', t:'GPT-5.4'},
                {v:'gpt-5.4-mini', t:'GPT-5.4 mini'},
                {v:'gpt-4.1', t:'GPT-4.1'},
                {v:'gpt-4.1-mini', t:'GPT-4.1 mini'}
            ];
        }
        if (!savedModel) savedModel = getDefaultModel(provider);
        models.forEach(function(m) {
            var opt = document.createElement('option');
            opt.value = m.v;
            opt.textContent = m.t;
            if (m.v === savedModel) opt.selected = true;
            sel.appendChild(opt);
        });
        if (savedModel && !models.some(function(m) { return m.v === savedModel; })) {
            var customOpt = document.createElement('option');
            customOpt.value = savedModel;
            customOpt.textContent = savedModel + ' (저장된 모델)';
            customOpt.selected = true;
            sel.appendChild(customOpt);
        }
        updateReasoningOptions(provider, sel.value);
    }


    // ============== 장기기억 일괄 편집 ==============
    function getSummaryId(item) {
        return item && (item.id || item._id || item.summaryId || item.summary_id);
    }

    async function updateExistingSummary(item, title, summary, options) {
        var id = getSummaryId(item);
        if (!id) throw new Error('장기기억 ID를 찾을 수 없습니다.');
        var res = await apiCall('PATCH', '/summaries/' + encodeURIComponent(id), { title: title, summary: summary }, options || {});
        if (!res) throw new Error('수정 요청이 실패했습니다.');
        return res;
    }

    async function deleteExistingSummary(item, options) {
        var id = getSummaryId(item);
        if (!id) throw new Error('장기기억 ID를 찾을 수 없습니다.');
        var res = await apiCall('DELETE', '/summaries/' + encodeURIComponent(id), null, options || {});
        if (!res) throw new Error('삭제 요청이 실패했습니다.');
        return res;
    }

    function isUserAddedSummary(item) {
        return !!item && (String(item.createdBy || '').toLowerCase() === 'user' || String(item.badge || '').trim() === '추가');
    }

    function isNativeSummary(item) {
        return !!item && String(item.createdBy || '').toLowerCase() === 'assistant' && String(item.badge || '').trim() !== '추가';
    }

    function summaryFingerprint(item) {
        return hashText(String(item && item.title || '').trim() + '\n' + String(item && item.summary || '').trim());
    }

    function summaryTime(item, preferCreated) {
        var value = preferCreated ? (item && (item.createdAt || item.updatedAt)) : (item && (item.updatedAt || item.createdAt));
        var parsed = Date.parse(value || '');
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function sortSummariesOldest(items) {
        return (items || []).slice().sort(function(a, b) {
            return summaryTime(a, true) - summaryTime(b, true) || String(getSummaryId(a) || '').localeCompare(String(getSummaryId(b) || ''));
        });
    }

    function getMessageText(message) {
        var value = message && (message.content != null ? message.content : message.message != null ? message.message : message.text);
        if (typeof value === 'string') return value.trim();
        if (value == null) return '';
        try { return JSON.stringify(value); } catch (e) { return String(value); }
    }

    function getMessageStableId(message) {
        return String(message && (message._id || message.id || message.messageId || message.turnId || message.createdAt) || '');
    }

    function isIncompleteAssistantMessage(message) {
        var status = String(message && (message.status || message.generationStatus || message.state) || '').toLowerCase();
        return ['pending', 'queued', 'streaming', 'generating', 'processing', 'in_progress', 'in-progress'].includes(status);
    }

    function buildCompletedDialogueTurns(messages) {
        var turns = [];
        var current = null;

        function pushCurrent() {
            if (!current || current.incomplete || !current.userText || !current.assistantParts.length) return;
            var assistantText = current.assistantParts.join('\n\n').trim();
            if (!assistantText) return;
            var key = current.assistantId || current.turnId || hashText(current.userText + '\n' + assistantText);
            turns.push({
                key:String(key),
                userText:current.userText,
                assistantText:assistantText,
                text:'User: ' + current.userText + '\n\nCharacter: ' + assistantText
            });
        }

        (messages || []).forEach(function(message) {
            var role = String(message && message.role || '').toLowerCase();
            var text = getMessageText(message);
            if (!text) return;
            if (role === 'user') {
                pushCurrent();
                current = { userText:text, assistantParts:[], assistantId:'', turnId:String(message.turnId || ''), incomplete:false };
                return;
            }
            if ((role === 'assistant' || role === 'character' || role === 'bot') && current) {
                if (isIncompleteAssistantMessage(message)) {
                    current.incomplete = true;
                    return;
                }
                current.assistantParts.push(text);
                current.assistantId = getMessageStableId(message) || current.assistantId;
                current.turnId = String(message.turnId || current.turnId || '');
            }
        });
        pushCurrent();
        return turns;
    }

    function findTurnIndex(turns, key) {
        if (!key) return -1;
        for (var i = 0; i < turns.length; i++) if (turns[i].key === key) return i;
        return -1;
    }

    function formatDialogueTurns(turns) {
        return (turns || []).map(function(turn, index) {
            return '[Dialogue turn ' + (index + 1) + ']\n' + turn.text;
        }).join('\n\n');
    }

    function formatMemoryCardsForPrompt(items) {
        if (!items || !items.length) return '(none)';
        return sortSummariesOldest(items).map(function(item) {
            return '[' + String(item.title || '').trim() + ']\n' + String(item.summary || '').trim();
        }).join('\n\n');
    }

    function makeManagedCardSnapshot(item) {
        return {
            title:String(item && item.title || '').trim(),
            summary:String(item && item.summary || '').trim(),
            createdAt:String(item && item.createdAt || ''),
            updatedAt:String(item && item.updatedAt || ''),
            createdBy:String(item && item.createdBy || ''),
            badge:String(item && item.badge || '')
        };
    }

    function getSavedAutoAiRuntime() {
        var provider = localStorage.getItem('crack_ext_api_provider') || 'google';
        var model = localStorage.getItem('crack_ext_' + provider + '_model') || getDefaultModel(provider);
        var apiKey = getSavedApiKey(provider);
        var firebaseScript = localStorage.getItem('crack_ext_firebase_script') || '';
        var vertexJson = getSavedVertexJson();
        if (provider !== 'firebase' && provider !== 'vertex' && !apiKey) throw new Error('자동 정리에 사용할 API Key가 없습니다.');
        if (provider === 'firebase' && !firebaseScript) throw new Error('자동 정리에 사용할 Firebase 설정이 없습니다.');
        if (provider === 'vertex' && !vertexJson) throw new Error('자동 정리에 사용할 Vertex JSON이 없습니다.');
        return {
            provider:provider,
            style:localStorage.getItem('crack_ext_summary_style') || 'concise',
            config:{
                apiKey:apiKey,
                model:model,
                firebaseScript:firebaseScript,
                vertexJson:vertexJson,
                vertexLocation:getSavedVertexLocation(),
                vertexProjectId:getSavedVertexProjectId(),
                reasoning:localStorage.getItem(getReasoningStorageKey(provider, model)) || 'auto'
            }
        };
    }

    function syncAutoNativeState(summaries, state, initialize) {
        var nativeItems = (summaries || []).filter(isNativeSummary);
        var currentIds = new Set(nativeItems.map(function(item) { return String(getSummaryId(item)); }));
        var pending = new Set((state.pendingNativeIds || []).filter(function(id) { return currentIds.has(String(id)); }).map(String));

        nativeItems.forEach(function(item) {
            var id = String(getSummaryId(item) || '');
            if (!id) return;
            var fingerprint = summaryFingerprint(item);
            if (!initialize && (!Object.prototype.hasOwnProperty.call(state.nativeHashes, id) || state.nativeHashes[id] !== fingerprint)) pending.add(id);
            state.nativeHashes[id] = fingerprint;
            if (state.managedHashes[id] === fingerprint && !state.managedCards[id]) state.managedCards[id] = makeManagedCardSnapshot(item);
        });

        Object.keys(state.nativeHashes).forEach(function(id) {
            if (!currentIds.has(id)) delete state.nativeHashes[id];
        });
        Object.keys(state.managedHashes).forEach(function(id) {
            var item = (summaries || []).find(function(summary) { return String(getSummaryId(summary)) === id; });
            if (!item) delete state.managedHashes[id];
        });
        state.pendingNativeIds = initialize ? [] : Array.from(pending);
    }

    function adoptStableNativeSummaries(summaries, state, includeAll) {
        var pendingIds = new Set((state.pendingNativeIds || []).map(String));
        var adopted = [];
        sortSummariesOldest((summaries || []).filter(isNativeSummary)).forEach(function(item) {
            var id = String(getSummaryId(item) || '');
            if (!id || (!includeAll && pendingIds.has(id))) return;
            var fingerprint = summaryFingerprint(item);
            state.nativeHashes[id] = fingerprint;
            state.managedHashes[id] = fingerprint;
            state.managedCards[id] = makeManagedCardSnapshot(item);
            adopted.push(item);
        });
        var managedNow = sortSummariesOldest((summaries || []).filter(function(item) {
            var id = String(getSummaryId(item) || '');
            return id && state.managedHashes[id] === summaryFingerprint(item);
        }));
        if (managedNow.length) {
            state.openTailId = String(getSummaryId(managedNow[managedNow.length - 1]) || '');
            state.midSegmentIds = managedNow.slice(-5).map(function(item) { return String(getSummaryId(item) || ''); });
        }
        state.needsV2InventoryMigration = false;
        return adopted;
    }

    function getLatestNativeBatch(nativeItems) {
        var sorted = (nativeItems || []).slice().sort(function(a, b) { return summaryTime(b, true) - summaryTime(a, true); });
        if (!sorted.length) return [];
        var newest = summaryTime(sorted[0], true);
        if (!newest) return sorted.slice(0, Math.min(4, sorted.length));
        return sorted.filter(function(item) { return Math.abs(newest - summaryTime(item, true)) <= 60000; });
    }

    function collectAutoMemoryInventory(summaries, state, settings) {
        var items = summaries || [];
        var byId = new Map();
        items.forEach(function(item) {
            var id = String(getSummaryId(item) || '');
            if (id) byId.set(id, item);
        });

        var managedLive = [];
        var recoveryContext = [];
        Object.keys(state.managedCards || {}).forEach(function(id) {
            var snapshot = state.managedCards[id];
            if (!snapshot || !snapshot.title || !snapshot.summary) return;
            var current = byId.get(String(id));
            if (current && state.managedHashes[id] === summaryFingerprint(current)) {
                if (canAutoMutateSummary(current, settings)) managedLive.push(current);
                return;
            }
            recoveryContext.push(Object.assign({ _id:id, __orphanedManaged:!current }, snapshot));
        });
        managedLive = sortSummariesOldest(managedLive);
        var managedIds = new Set(managedLive.map(function(item) { return String(getSummaryId(item)); }));

        var openTail = managedLive.find(function(item) { return String(getSummaryId(item)) === String(state.openTailId || ''); }) || null;
        if (!openTail && managedLive.length) {
            openTail = managedLive[managedLive.length - 1];
            state.openTailId = String(getSummaryId(openTail) || '');
        }
        if (openTail && !state.midSegmentIds.length) state.midSegmentIds = [String(getSummaryId(openTail))];

        var pendingIds = new Set((state.pendingNativeIds || []).map(String));
        var freshSlots = sortSummariesOldest(items.filter(function(item) {
            var id = String(getSummaryId(item) || '');
            return id && pendingIds.has(id) && isNativeSummary(item) && !managedIds.has(id);
        }));

        var contextCandidates = items.filter(function(item) { return settings.protectUserAdded && isUserAddedSummary(item); })
            .concat(managedLive.filter(function(item) { return !openTail || String(getSummaryId(item)) !== String(getSummaryId(openTail)); }));
        var contextById = new Map();
        sortSummariesOldest(contextCandidates).slice(-settings.contextCards).forEach(function(item) {
            contextById.set(String(getSummaryId(item)), item);
        });

        return {
            byId:byId,
            managedLive:managedLive,
            managedIds:managedIds,
            openTail:openTail,
            freshSlots:freshSlots,
            protectedContext:sortSummariesOldest(Array.from(contextById.values())),
            recoveryContext:sortSummariesOldest(recoveryContext),
            recoveryIds:recoveryContext.map(function(item) { return String(getSummaryId(item)); })
        };
    }

    function makeSlotFingerprintMap(items) {
        return (items || []).reduce(function(map, item) {
            map[String(getSummaryId(item))] = summaryFingerprint(item);
            return map;
        }, {});
    }

    function selectRoutineAppendPlan(summaries, state, settings) {
        var inventory = collectAutoMemoryInventory(summaries, state, settings);
        if (!inventory.openTail && !inventory.freshSlots.length) return null;
        var targets = (inventory.openTail ? [inventory.openTail] : []).concat(inventory.freshSlots);
        return {
            mode:'routine',
            openTail:inventory.openTail,
            freshSlots:inventory.freshSlots,
            protectedContext:inventory.protectedContext,
            recoveryContext:inventory.recoveryContext,
            recoveryIds:inventory.recoveryIds,
            rewriteSlots:targets,
            slotFingerprints:makeSlotFingerprintMap(targets),
            currentManagedIds:inventory.managedLive.map(function(item) { return String(getSummaryId(item)); })
        };
    }

    function selectMidMergePlan(summaries, state, settings) {
        var inventory = collectAutoMemoryInventory(summaries, state, settings);
        var liveById = new Map(inventory.managedLive.map(function(item) { return [String(getSummaryId(item)), item]; }));
        var openTailId = inventory.openTail ? String(getSummaryId(inventory.openTail)) : '';
        var segmentIds = Array.from(new Set((state.midSegmentIds || []).map(String).filter(function(id) { return liveById.has(id); })));
        var editable = segmentIds.filter(function(id) { return id !== openTailId; }).map(function(id) { return liveById.get(id); });
        editable = sortSummariesOldest(editable);
        if (editable.length < 2) return null;

        var editableIds = new Set(editable.map(function(item) { return String(getSummaryId(item)); }));
        var contextById = new Map(inventory.protectedContext.filter(function(item) {
            return !editableIds.has(String(getSummaryId(item)));
        }).map(function(item) { return [String(getSummaryId(item)), item]; }));
        if (inventory.openTail) contextById.set(openTailId, inventory.openTail);
        inventory.managedLive.slice(-settings.contextCards).forEach(function(item) {
            var id = String(getSummaryId(item));
            if (!editableIds.has(id)) contextById.set(id, item);
        });
        return {
            mode:'mid',
            editableTrusted:editable,
            protectedContext:sortSummariesOldest(Array.from(contextById.values())),
            recoveryContext:[],
            recoveryIds:[],
            rewriteSlots:editable,
            slotFingerprints:makeSlotFingerprintMap(editable),
            slotLimit:editable.length,
            expectedCount:null,
            allowedDeleteIds:editable.map(function(item) { return String(getSummaryId(item)); }),
            openTailId:openTailId
        };
    }

    function selectFullCompactPlan(summaries, state, settings) {
        var inventory = collectAutoMemoryInventory(summaries, state, settings);
        var mutable = sortSummariesOldest((summaries || []).filter(function(item) { return canAutoMutateSummary(item, settings); }));
        if (!mutable.length) return null;
        var mutableIds = new Set(mutable.map(function(item) { return String(getSummaryId(item)); }));
        var protectedContext = sortSummariesOldest((summaries || []).filter(function(item) {
            return !mutableIds.has(String(getSummaryId(item)));
        }));
        var untouchedCount = protectedContext.length;
        var desiredCount = Math.max(1, settings.compactTarget - untouchedCount);
        if (untouchedCount + desiredCount > settings.maxCards) throw new Error('보호된 [추가] 카드만으로 최대 슬롯 수에 도달해 전체 압축이 불가능합니다.');
        var userEditable = mutable.filter(function(item) { return isUserAddedSummary(item); });
        var editableById = new Map(inventory.managedLive.concat(userEditable).map(function(item) { return [String(getSummaryId(item)), item]; }));
        var editableTrusted = sortSummariesOldest(Array.from(editableById.values()));
        var informationSourceCount = editableTrusted.length + inventory.recoveryContext.length;
        var expectedCount = Math.min(mutable.length, desiredCount, Math.max(1, informationSourceCount));
        if (untouchedCount + expectedCount > settings.maxCards) throw new Error('보호된 [추가] 카드 때문에 최대 슬롯 수를 맞출 수 없습니다.');
        return {
            mode:'full',
            editableTrusted:editableTrusted,
            protectedContext:protectedContext,
            recoveryContext:inventory.recoveryContext,
            recoveryIds:inventory.recoveryIds,
            rewriteSlots:mutable,
            slotFingerprints:makeSlotFingerprintMap(mutable),
            slotLimit:expectedCount,
            expectedCount:expectedCount,
            allowedDeleteIds:mutable.map(function(item) { return String(getSummaryId(item)); })
        };
    }

    function buildAutoAppendInput(plan, dialogueTurns) {
        return '[SEALED MEMORIES — CONTEXT ONLY]\n' + formatMemoryCardsForPrompt(plan.protectedContext) + '\n\n' +
            '[OPEN TAIL — UPDATE ONLY FOR A DIRECT CONTINUATION]\n' + formatMemoryCardsForPrompt(plan.openTail ? [plan.openTail] : []) + '\n\n' +
            '[RECOVERY MEMORIES — PRESERVE ALL STILL-VALID FACTS]\n' + formatMemoryCardsForPrompt(plan.recoveryContext) + '\n\n' +
            '[FRESH SLOT CAPACITY]\n' + plan.freshSlots.length + ' existing assistant storage slot(s) are available for newCards. Their old contents are not facts.\n\n' +
            '[NEW DIALOGUE]\n' + formatDialogueTurns(dialogueTurns) + '\n\n' +
            '[DECISION]\nPreserve old anchors first. Update only the directly continued OPEN TAIL; append independent events as newCards. If essential newCards would exceed capacity, return WAIT_FOR_SLOT without partial work.';
    }

    function buildAutoCompactionInput(plan) {
        var countInstruction = plan.expectedCount == null
            ? 'Return 1 to ' + plan.slotLimit + ' cards. Let the active second-compression prompt decide the useful grouping; never pad or force an arbitrary half-size result.'
            : 'Return exactly ' + plan.expectedCount + ' cards.';
        return '[PROTECTED CONTEXT — REFERENCE ONLY]\n' + formatMemoryCardsForPrompt(plan.protectedContext) + '\n\n' +
            '[RECOVERY MEMORIES — MERGE STILL-VALID FACTS WHEN PRESENT]\n' + formatMemoryCardsForPrompt(plan.recoveryContext) + '\n\n' +
            '[EDITABLE COMPACTION TARGETS — REPLACE ONLY THESE]\n' + formatMemoryCardsForPrompt(plan.editableTrusted) + '\n\n' +
            '[OUTPUT COUNT]\n' + countInstruction + ' Preserve independent anchors; compress overlap and repeated detail first.';
    }

    function validateAutoCardData(card, label) {
        if (!card || typeof card !== 'object' || Array.isArray(card)) throw new Error(label + ' 카드 형식이 올바르지 않습니다.');
        var keys = Object.keys(card).sort().join(',');
        if (keys !== 'summary,title') throw new Error(label + ' 카드에는 title과 summary만 있어야 합니다.');
        if (typeof card.title !== 'string' || typeof card.summary !== 'string' || card.title !== card.title.trim() || card.summary !== card.summary.trim()) {
            throw new Error(label + ' 카드 제목과 본문은 앞뒤 공백 없는 문자열이어야 합니다.');
        }
        var title = card.title;
        var wrappedTitle = title.match(/^\[([^\[\]\r\n]+)\]$/);
        if (wrappedTitle) title = wrappedTitle[1].trim();
        if (!title || !card.summary) throw new Error(label + ' 카드에 빈 제목 또는 본문이 있습니다.');
        if (/[\[\]]/.test(title)) throw new Error(label + ' JSON 제목에는 [ 또는 ] 문자를 넣을 수 없습니다: ' + title);
        if (title.length > GENERATED_TITLE_MAX) throw new Error(label + ' 제목이 ' + GENERATED_TITLE_MAX + '자를 초과했습니다: ' + title);
        if (card.summary.length > GENERATED_SUMMARY_MAX) throw new Error(label + ' 본문이 ' + GENERATED_SUMMARY_MAX + '자를 초과했습니다: ' + card.title);
        if (/\r|\n/.test(title) || /\r|\n/.test(card.summary)) throw new Error(label + ' 카드에는 줄바꿈을 넣을 수 없습니다.');
        if (card.summary.charAt(0) === '[') throw new Error(label + ' 본문은 [ 문자로 시작할 수 없습니다: ' + card.title);
        return { title:title, summary:card.summary };
    }

    function validateAutoAppendResult(rawText, plan) {
        var cleaned = String(rawText || '').trim();
        if (!cleaned || cleaned.length > 65536 || cleaned.indexOf('```') !== -1) throw new Error('AI가 자동 누적 JSON 형식 외의 텍스트를 반환했습니다.');
        var parsed;
        try { parsed = JSON.parse(cleaned); } catch (err) { throw new Error('AI 자동 누적 결과가 올바른 JSON이 아닙니다.'); }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('AI 자동 누적 결과는 JSON 객체여야 합니다.');
        if (Object.keys(parsed).sort().join(',') !== 'decision,newCards,tail,version' || parsed.version !== 1 || !Array.isArray(parsed.newCards)) {
            throw new Error('AI 자동 누적 JSON의 필수 필드가 올바르지 않습니다.');
        }
        if (!parsed.tail || typeof parsed.tail !== 'object' || Array.isArray(parsed.tail) || Object.keys(parsed.tail).sort().join(',') !== 'action,summary,title') {
            throw new Error('AI 자동 누적 JSON의 tail 필드가 올바르지 않습니다.');
        }
        var action = parsed.tail.action;
        if (!['KEEP', 'UPDATE'].includes(action)) throw new Error('tail.action은 KEEP 또는 UPDATE여야 합니다.');
        if (parsed.decision === 'WAIT_FOR_SLOT') {
            if (action !== 'KEEP' || parsed.tail.title !== '' || parsed.tail.summary !== '' || parsed.newCards.length) {
                throw new Error('WAIT_FOR_SLOT은 변경 내용을 함께 반환할 수 없습니다.');
            }
            return { waiting:true, tailAction:'KEEP', tailCard:null, newCards:[] };
        }
        if (parsed.decision !== 'APPLY') throw new Error('decision은 APPLY 또는 WAIT_FOR_SLOT이어야 합니다.');
        var tailCard = null;
        if (action === 'UPDATE') {
            if (!plan.openTail) throw new Error('OPEN TAIL이 없는데 UPDATE를 요청했습니다.');
            tailCard = validateAutoCardData({ title:parsed.tail.title, summary:parsed.tail.summary }, 'OPEN TAIL');
            var openTailId = String(getSummaryId(plan.openTail) || '');
            if (hashText(tailCard.title + '\n' + tailCard.summary) === String(plan.slotFingerprints[openTailId] || '')) {
                tailCard = null;
                action = 'KEEP';
            }
        } else if (parsed.tail.title !== '' || parsed.tail.summary !== '') {
            throw new Error('tail.action KEEP일 때 title과 summary는 빈 문자열이어야 합니다.');
        }
        if (parsed.newCards.length > plan.freshSlots.length) {
            return { waiting:true, tailAction:'KEEP', tailCard:null, newCards:[] };
        }
        var newCards = parsed.newCards.map(function(card, index) { return validateAutoCardData(card, '새 ' + (index + 1) + '번'); });
        if (!tailCard && !newCards.length) throw new Error('APPLY 결과에 실제 UPDATE 또는 새 카드가 없습니다.');
        var signatures = new Set();
        (tailCard ? [tailCard] : []).concat(newCards).forEach(function(card) {
            var signature = card.title.toLowerCase() + '\n' + card.summary.replace(/\s+/g, ' ').toLowerCase();
            if (signatures.has(signature)) throw new Error('중복된 자동 누적 카드가 있습니다: ' + card.title);
            signatures.add(signature);
        });
        return { waiting:false, tailAction:action, tailCard:tailCard, newCards:newCards };
    }

    function validateAutoGeneratedCards(rawText, slotLimit, expectedCount) {
        var cleaned = String(rawText || '').replace(/\r\n?/g, '\n').trim();
        if (!cleaned || cleaned.indexOf('```') !== -1) throw new Error('AI가 자동 저장 형식 외의 텍스트를 반환했습니다.');
        var blocks = cleaned.split(/\n{2,}/);
        var cards = blocks.map(function(block) {
            var match = block.match(/^\[([^\]\n]+)\]\n([^\n]+)$/);
            if (!match) throw new Error('자동 저장 출력은 [제목] 다음 한 줄 본문 형식이어야 합니다.');
            return { title:match[1].trim(), summary:match[2].trim() };
        });
        if (!cards.length) throw new Error('AI 요약 카드가 없습니다.');
        if (cards.length > slotLimit) throw new Error('AI가 슬롯 한도 ' + slotLimit + '개를 초과했습니다.');
        if (expectedCount != null && cards.length !== expectedCount) throw new Error('AI가 정확히 ' + expectedCount + '개 대신 ' + cards.length + '개를 반환했습니다.');
        var seenTitles = new Set();
        var seenCards = new Set();
        cards.forEach(function(card) {
            if (!card.title || !card.summary) throw new Error('빈 제목 또는 본문이 있습니다.');
            if (card.title.length > GENERATED_TITLE_MAX) throw new Error('AI 제목이 ' + GENERATED_TITLE_MAX + '자를 초과했습니다: ' + card.title);
            if (card.summary.length > GENERATED_SUMMARY_MAX) throw new Error('AI 본문이 ' + GENERATED_SUMMARY_MAX + '자를 초과했습니다: ' + card.title);
            if (card.summary.charAt(0) === '[') throw new Error('AI 본문은 [ 문자로 시작할 수 없습니다: ' + card.title);
            var titleSignature = card.title.toLowerCase();
            var signature = card.title.toLowerCase() + '\n' + card.summary.replace(/\s+/g, ' ').toLowerCase();
            if (seenTitles.has(titleSignature) || seenCards.has(signature)) throw new Error('중복된 AI 카드가 있습니다: ' + card.title);
            seenTitles.add(titleSignature);
            seenCards.add(signature);
        });
        return cards;
    }

    function canAutoMutateSummary(item, settings) {
        return isNativeSummary(item) || (!settings.protectUserAdded && isUserAddedSummary(item));
    }

    function laterTurnKey(turns, currentKey, candidateKey) {
        if (!currentKey) return candidateKey || '';
        if (!candidateKey) return currentKey;
        var currentIndex = findTurnIndex(turns, currentKey);
        var candidateIndex = findTurnIndex(turns, candidateKey);
        if (currentIndex < 0 || candidateIndex < 0) return currentKey;
        return candidateIndex > currentIndex ? candidateKey : currentKey;
    }

    function createAutoApplyCommit(state, turns, batchTurns, manual, compactionOnly, metadata) {
        var previousProcessedKey = String(state.lastProcessedTurnKey || '');
        var commit = {
            lastScheduleTurnKey:String(state.lastScheduleTurnKey || ''),
            lastProcessedTurnKey:String(state.lastProcessedTurnKey || ''),
            pendingCutoffTurnKey:String(state.pendingCutoffTurnKey || ''),
            observedNewTurns:Number(state.observedNewTurns) || 0,
            openTailId:String(state.openTailId || ''),
            midSegmentIds:(state.midSegmentIds || []).map(String).filter(Boolean),
            processedSinceMidMerge:Math.max(0, Number(state.processedSinceMidMerge) || 0),
            forceFullCompact:!!state.forceFullCompact,
            fullBeforeRoutine:!!state.fullBeforeRoutine,
            settingsSignature:String(state.settingsSignature || '')
        };
        if (!compactionOnly && batchTurns.length) {
            commit.lastProcessedTurnKey = laterTurnKey(turns, commit.lastProcessedTurnKey, batchTurns[batchTurns.length - 1].key);
            if (commit.lastProcessedTurnKey === commit.pendingCutoffTurnKey) commit.pendingCutoffTurnKey = '';
        }
        if (manual) {
            var manualKey = batchTurns[batchTurns.length - 1].key;
            var previousScheduleKey = commit.lastScheduleTurnKey;
            commit.lastScheduleTurnKey = laterTurnKey(turns, commit.lastScheduleTurnKey, manualKey);
            commit.lastProcessedTurnKey = laterTurnKey(turns, commit.lastProcessedTurnKey, manualKey);
            var pendingIndex = findTurnIndex(turns, commit.pendingCutoffTurnKey);
            var processedIndex = findTurnIndex(turns, commit.lastProcessedTurnKey);
            if (pendingIndex >= 0 && processedIndex >= pendingIndex) commit.pendingCutoffTurnKey = '';
            if (commit.lastScheduleTurnKey !== previousScheduleKey) commit.observedNewTurns = 0;
        }
        if (!compactionOnly && commit.lastProcessedTurnKey !== previousProcessedKey) {
            var previousIndex = findTurnIndex(turns, previousProcessedKey);
            var nextIndex = findTurnIndex(turns, commit.lastProcessedTurnKey);
            var processedDelta = previousIndex >= 0 && nextIndex >= previousIndex ? nextIndex - previousIndex : batchTurns.length;
            commit.processedSinceMidMerge += Math.max(0, processedDelta);
        }
        Object.keys(metadata || {}).forEach(function(key) { commit[key] = metadata[key]; });
        return commit;
    }

    function createPendingAutoApply(plan, cards, commit, settings) {
        var patches = cards.map(function(card, index) {
            var slot = plan.rewriteSlots[index];
            var id = String(getSummaryId(slot) || '');
            return {
                id:id,
                beforeHash:String(plan.slotFingerprints[id] || ''),
                afterHash:hashText(card.title + '\n' + card.summary),
                title:card.title,
                summary:card.summary
            };
        });
        var deletes = plan.rewriteSlots.slice(cards.length).map(function(slot) {
            var id = String(getSummaryId(slot) || '');
            return { id:id, beforeHash:String(plan.slotFingerprints[id] || '') };
        });
        return {
            version:1,
            operationMode:String(plan.mode || 'legacy'),
            phase:'patch',
            patches:patches,
            deletes:deletes,
            allowedDeleteIds:Array.isArray(plan.allowedDeleteIds) ? plan.allowedDeleteIds.map(String) : null,
            patchIndex:0,
            deleteIndex:0,
            mutationStarted:false,
            recoveryIds:(plan.recoveryIds || []).slice(),
            commit:commit,
            settingsSignature:getAutoMemorySettingsSignature(settings),
            settingsProtectUserAdded:settings.protectUserAdded !== false,
            createdAt:Date.now()
        };
    }

    function getRoutineCommitMetadata(state, plan, result) {
        var liveIds = new Set((plan.currentManagedIds || []).map(String));
        var segmentIds = Array.from(new Set((state.midSegmentIds || []).map(String).filter(function(id) { return liveIds.has(id); })));
        var currentTailId = plan.openTail ? String(getSummaryId(plan.openTail) || '') : '';
        if (currentTailId && !segmentIds.includes(currentTailId)) segmentIds.push(currentTailId);
        var newIds = plan.freshSlots.slice(0, result.newCards.length).map(function(item) { return String(getSummaryId(item) || ''); }).filter(Boolean);
        newIds.forEach(function(id) { if (!segmentIds.includes(id)) segmentIds.push(id); });
        return {
            openTailId:newIds.length ? newIds[newIds.length - 1] : currentTailId,
            midSegmentIds:segmentIds
        };
    }

    function createPendingAutoAppend(plan, result, commit, settings) {
        var patches = [];
        if (result.tailAction === 'UPDATE') {
            var tailId = String(getSummaryId(plan.openTail) || '');
            patches.push({
                id:tailId,
                beforeHash:String(plan.slotFingerprints[tailId] || ''),
                afterHash:hashText(result.tailCard.title + '\n' + result.tailCard.summary),
                title:result.tailCard.title,
                summary:result.tailCard.summary
            });
        }
        result.newCards.forEach(function(card, index) {
            var slot = plan.freshSlots[index];
            var id = String(getSummaryId(slot) || '');
            patches.push({
                id:id,
                beforeHash:String(plan.slotFingerprints[id] || ''),
                afterHash:hashText(card.title + '\n' + card.summary),
                title:card.title,
                summary:card.summary
            });
        });
        var deletes = (commit.pendingCutoffTurnKey ? [] : plan.freshSlots.slice(result.newCards.length)).map(function(slot) {
            var id = String(getSummaryId(slot) || '');
            return { id:id, beforeHash:String(plan.slotFingerprints[id] || '') };
        });
        return {
            version:1,
            operationMode:'routine',
            phase:'patch',
            patches:patches,
            deletes:deletes,
            allowedDeleteIds:plan.freshSlots.map(function(item) { return String(getSummaryId(item) || ''); }),
            patchIndex:0,
            deleteIndex:0,
            mutationStarted:false,
            recoveryIds:(plan.recoveryIds || []).slice(),
            commit:commit,
            settingsSignature:getAutoMemorySettingsSignature(settings),
            settingsProtectUserAdded:settings.protectUserAdded !== false,
            createdAt:Date.now()
        };
    }

    function validatePendingAutoApply(pending) {
        if (!pending || pending.version !== 1 || !Array.isArray(pending.patches) || !Array.isArray(pending.deletes) || !pending.commit) {
            throw new Error('미완료 저장 상태가 손상되었습니다. 자동으로 변경하지 않습니다.');
        }
        if (pending.patches.length < 1 || !['patch', 'delete', 'verify'].includes(pending.phase)) {
            throw new Error('미완료 저장 단계가 올바르지 않습니다. 자동으로 변경하지 않습니다.');
        }
        if (!Number.isInteger(pending.patchIndex) || pending.patchIndex < 0 || pending.patchIndex > pending.patches.length ||
            !Number.isInteger(pending.deleteIndex) || pending.deleteIndex < 0 || pending.deleteIndex > pending.deletes.length) {
            throw new Error('미완료 저장 위치가 올바르지 않습니다. 자동으로 변경하지 않습니다.');
        }
        if (typeof pending.commit.lastScheduleTurnKey !== 'string' || typeof pending.commit.lastProcessedTurnKey !== 'string' ||
            typeof pending.commit.pendingCutoffTurnKey !== 'string' || !Number.isFinite(Number(pending.commit.observedNewTurns))) {
            throw new Error('미완료 저장 기준점이 올바르지 않습니다. 자동으로 변경하지 않습니다.');
        }
        if (pending.operationMode != null && !['legacy', 'routine', 'mid', 'full'].includes(String(pending.operationMode))) {
            throw new Error('미완료 저장 모드가 올바르지 않습니다. 자동으로 변경하지 않습니다.');
        }
        if (pending.settingsSignature != null && typeof pending.settingsSignature !== 'string') {
            throw new Error('미완료 저장 계획의 설정 기준이 올바르지 않습니다. 자동으로 변경하지 않습니다.');
        }
        if (pending.settingsProtectUserAdded != null && typeof pending.settingsProtectUserAdded !== 'boolean') {
            throw new Error('미완료 저장 계획의 보호 설정이 올바르지 않습니다. 자동으로 변경하지 않습니다.');
        }
        if (pending.allowedDeleteIds != null) {
            if (!Array.isArray(pending.allowedDeleteIds)) throw new Error('미완료 삭제 허용목록이 올바르지 않습니다. 자동으로 변경하지 않습니다.');
            var allowedDeleteIds = new Set(pending.allowedDeleteIds.map(String));
            if (pending.deletes.some(function(entry) { return !entry || !allowedDeleteIds.has(String(entry.id)); })) {
                throw new Error('허용되지 않은 카드가 DELETE 계획에 포함되어 자동으로 변경하지 않습니다.');
            }
        }
        if (pending.commit.openTailId != null && typeof pending.commit.openTailId !== 'string') throw new Error('미완료 꼬리 카드 상태가 올바르지 않습니다.');
        if (pending.commit.midSegmentIds != null && !Array.isArray(pending.commit.midSegmentIds)) throw new Error('미완료 중간 병합 상태가 올바르지 않습니다.');
        if (pending.commit.processedSinceMidMerge != null && !Number.isFinite(Number(pending.commit.processedSinceMidMerge))) throw new Error('미완료 중간 병합 턴수가 올바르지 않습니다.');
        if (pending.commit.forceFullCompact != null && typeof pending.commit.forceFullCompact !== 'boolean') throw new Error('미완료 전체 압축 상태가 올바르지 않습니다.');
        if (pending.commit.fullBeforeRoutine != null && typeof pending.commit.fullBeforeRoutine !== 'boolean') throw new Error('미완료 전체 압축 순서 상태가 올바르지 않습니다.');
        if (pending.commit.settingsSignature != null && typeof pending.commit.settingsSignature !== 'string') throw new Error('미완료 설정 기준 상태가 올바르지 않습니다.');
        var ids = new Set();
        pending.patches.forEach(function(entry) {
            if (!entry || !entry.id || !entry.beforeHash || !entry.afterHash || !entry.title || !entry.summary ||
                entry.afterHash !== hashText(String(entry.title).trim() + '\n' + String(entry.summary).trim()) ||
                String(entry.title).trim().length > GENERATED_TITLE_MAX || String(entry.summary).trim().length > GENERATED_SUMMARY_MAX || ids.has(String(entry.id))) {
                throw new Error('미완료 PATCH 계획이 올바르지 않습니다. 자동으로 변경하지 않습니다.');
            }
            if (/\r|\n/.test(String(entry.title)) || /\r|\n/.test(String(entry.summary))) {
                throw new Error('미완료 PATCH 내용에 허용되지 않은 줄바꿈이 있습니다. 자동으로 변경하지 않습니다.');
            }
            ids.add(String(entry.id));
        });
        pending.deletes.forEach(function(entry) {
            if (!entry || !entry.id || !entry.beforeHash || ids.has(String(entry.id))) {
                throw new Error('미완료 DELETE 계획이 올바르지 않습니다. 자동으로 변경하지 않습니다.');
            }
            ids.add(String(entry.id));
        });
        if (!Array.isArray(pending.recoveryIds)) pending.recoveryIds = [];
        if (typeof pending.mutationStarted !== 'boolean') pending.mutationStarted = pending.patchIndex > 0 || pending.deleteIndex > 0 || pending.phase !== 'patch';
        return pending;
    }

    function assertPendingDeletePreflight(pending, byId, settings) {
        pending.patches.forEach(function(entry) {
            var item = byId.get(String(entry.id));
            if (!item || summaryFingerprint(item) !== entry.afterHash) {
                throw new Error('DELETE 전 PATCH 전체 검증에 실패했습니다: ' + entry.id);
            }
        });
        for (var index = pending.deleteIndex; index < pending.deletes.length; index++) {
            var entry = pending.deletes[index];
            var item = byId.get(String(entry.id));
            if (!item) continue;
            if (summaryFingerprint(item) !== entry.beforeHash) throw new Error('DELETE 대상이 외부에서 변경되어 중단했습니다: ' + entry.id);
            if (!canAutoMutateSummary(item, settings)) throw new Error('보호된 카드가 DELETE 대상에 포함되어 중단했습니다.');
        }
    }

    function resetAutoMemoryPlanningForSettings(state, settingsSignature, chatId) {
        state.lastScheduleTurnKey = String(state.lastProcessedTurnKey || '');
        state.pendingCutoffTurnKey = '';
        state.observedNewTurns = 0;
        state.forceFullCompact = false;
        state.fullBeforeRoutine = false;
        state.waitingForSlot = false;
        state.settingsSignature = String(settingsSignature || getAutoMemorySettingsSignature(getAutoMemorySettings(chatId)));
    }

    function safelyResetAutoMemoryPlanningAfterSettingsSave(chatId, settings) {
        if (!chatId || AUTO_MEMORY_BUSY || !acquireAutoMemoryLock(chatId)) return false;
        try {
            var state = getAutoMemoryState(chatId);
            if (state.pendingApply && state.pendingApply.mutationStarted) return false;
            state.pendingApply = null;
            resetAutoMemoryPlanningForSettings(state, getAutoMemorySettingsSignature(settings), chatId);
            clearAutoMemoryFailure(state);
            state.lastError = '';
            state.lastStatus = '설정 변경 반영 · 최신 값으로 재계획 대기';
            saveAutoMemoryState(chatId, state);
            return true;
        } finally {
            releaseAutoMemoryLock(chatId);
        }
    }

    function finishAutoMemorySettingsTransition(chatId, state, planSettingsSignature, status) {
        var latestSignature = getAutoMemorySettingsSignature(getAutoMemorySettings(chatId));
        if (!isAutoMemorySettingsEditPending(chatId) && String(planSettingsSignature || latestSignature) === latestSignature && state.settingsSignature === latestSignature) return false;
        resetAutoMemoryPlanningForSettings(state, latestSignature, chatId);
        state.lastStatus = status || '설정 변경 반영 · 최신 값으로 재계획 대기';
        clearAutoMemoryFailure(state);
        saveAutoMemoryState(chatId, state);
        if (getChatId() === chatId) scheduleAutoMemoryResponseCheck(isAutoMemorySettingsEditPending(chatId) ? AUTO_MEMORY_SETTINGS_AUTOSAVE_MS + 100 : 100);
        return true;
    }

    function getPendingMutationSettings(pending, fallbackSettings, chatId) {
        var effective = Object.assign({}, fallbackSettings || getAutoMemorySettings(chatId));
        if (pending && pending.mutationStarted && typeof pending.settingsProtectUserAdded === 'boolean') {
            effective.protectUserAdded = pending.settingsProtectUserAdded || effective.protectUserAdded;
        }
        return effective;
    }

    function discardUnstartedPendingForSettingsChange(chatId, state, pending) {
        if (!pending || pending.mutationStarted) return false;
        if (!isAutoMemorySettingsEditPending(chatId) && pending.settingsSignature && isAutoMemorySettingsSignatureCurrent(pending.settingsSignature, chatId)) return false;
        state.pendingApply = null;
        resetAutoMemoryPlanningForSettings(state, '', chatId);
        state.lastStatus = '설정 변경 감지 · 최신 값으로 재계획 대기';
        state.lastError = '';
        saveAutoMemoryState(chatId, state);
        return true;
    }

    async function resumePendingAutoApply(chatId, state, settings) {
        var pending = validatePendingAutoApply(state.pendingApply);
        if (discardUnstartedPendingForSettingsChange(chatId, state, pending)) {
            return { replan:true, patched:0, deleted:0, deleteFailures:0, total:0 };
        }
        if (!renewAutoMemoryLock(chatId)) throw new Error('자동 저장 잠금을 잃어 변경을 중단했습니다.');
        var summaries = await fetchSummaries({ silent:true, strict:true, chatId:chatId });
        var byId = new Map(summaries.map(function(item) { return [String(getSummaryId(item) || ''), item]; }));

        while (pending.patchIndex < pending.patches.length) {
            var patch = pending.patches[pending.patchIndex];
            var current = byId.get(String(patch.id));
            if (!current) throw new Error('PATCH 대상 슬롯이 사라져 저장을 중단했습니다: ' + patch.id);
            var currentHash = summaryFingerprint(current);
            if (currentHash !== patch.afterHash) {
                if (currentHash !== patch.beforeHash) throw new Error('PATCH 대상이 외부에서 변경되어 중단했습니다: ' + patch.id);
                if (discardUnstartedPendingForSettingsChange(chatId, state, pending)) {
                    return { replan:true, patched:0, deleted:0, deleteFailures:0, total:summaries.length };
                }
                var currentSettings = getPendingMutationSettings(pending, getAutoMemorySettings(chatId), chatId);
                if (!canAutoMutateSummary(current, currentSettings)) throw new Error('보호된 카드가 PATCH 대상에 포함되어 중단했습니다.');
                if (!renewAutoMemoryLock(chatId)) throw new Error('PATCH 직전 자동 저장 잠금을 잃어 중단했습니다.');
                pending.mutationStarted = true;
                saveAutoMemoryState(chatId, state);
                await updateExistingSummary(current, patch.title, patch.summary, { silent:true, strict:true, chatId:chatId });
                summaries = await fetchSummaries({ silent:true, strict:true, chatId:chatId });
                byId = new Map(summaries.map(function(item) { return [String(getSummaryId(item) || ''), item]; }));
                current = byId.get(String(patch.id));
                if (!current || summaryFingerprint(current) !== patch.afterHash) throw new Error('PATCH 결과 검증에 실패했습니다. DELETE는 시작하지 않았습니다.');
            }
            state.managedHashes[patch.id] = patch.afterHash;
            state.managedCards[patch.id] = makeManagedCardSnapshot(current);
            if (isNativeSummary(current)) state.nativeHashes[patch.id] = patch.afterHash;
            pending.patchIndex++;
            saveAutoMemoryState(chatId, state);
        }

        summaries = await fetchSummaries({ silent:true, strict:true, chatId:chatId });
        byId = new Map(summaries.map(function(item) { return [String(getSummaryId(item) || ''), item]; }));
        assertPendingDeletePreflight(pending, byId, getPendingMutationSettings(pending, getAutoMemorySettings(chatId), chatId));
        if (pending.phase === 'patch') {
            pending.phase = 'delete';
            saveAutoMemoryState(chatId, state);
        }

        while (pending.deleteIndex < pending.deletes.length) {
            summaries = await fetchSummaries({ silent:true, strict:true, chatId:chatId });
            byId = new Map(summaries.map(function(item) { return [String(getSummaryId(item) || ''), item]; }));
            assertPendingDeletePreflight(pending, byId, getPendingMutationSettings(pending, getAutoMemorySettings(chatId), chatId));
            var deletion = pending.deletes[pending.deleteIndex];
            var deleteTarget = byId.get(String(deletion.id));
            if (deleteTarget) {
                if (summaryFingerprint(deleteTarget) !== deletion.beforeHash) throw new Error('DELETE 대상이 외부에서 변경되어 중단했습니다: ' + deletion.id);
                if (discardUnstartedPendingForSettingsChange(chatId, state, pending)) {
                    return { replan:true, patched:0, deleted:0, deleteFailures:0, total:summaries.length };
                }
                var latestSettings = getPendingMutationSettings(pending, getAutoMemorySettings(chatId), chatId);
                if (!canAutoMutateSummary(deleteTarget, latestSettings)) throw new Error('보호된 카드가 DELETE 대상에 포함되어 중단했습니다.');
                if (!renewAutoMemoryLock(chatId)) throw new Error('DELETE 직전 자동 저장 잠금을 잃어 중단했습니다.');
                pending.mutationStarted = true;
                saveAutoMemoryState(chatId, state);
                await deleteExistingSummary(deleteTarget, { silent:true, strict:true, chatId:chatId });
                summaries = await fetchSummaries({ silent:true, strict:true, chatId:chatId });
                byId = new Map(summaries.map(function(item) { return [String(getSummaryId(item) || ''), item]; }));
                if (byId.has(String(deletion.id))) throw new Error('DELETE 결과 검증에 실패했습니다: ' + deletion.id);
            }
            delete state.nativeHashes[deletion.id];
            delete state.managedHashes[deletion.id];
            delete state.managedCards[deletion.id];
            pending.deleteIndex++;
            saveAutoMemoryState(chatId, state);
        }

        if (pending.phase === 'delete') {
            pending.phase = 'verify';
            saveAutoMemoryState(chatId, state);
        }

        summaries = await fetchSummaries({ silent:true, strict:true, chatId:chatId });
        byId = new Map(summaries.map(function(item) { return [String(getSummaryId(item) || ''), item]; }));
        pending.patches.forEach(function(entry) {
            var item = byId.get(String(entry.id));
            if (!item || summaryFingerprint(item) !== entry.afterHash) throw new Error('최종 PATCH 검증에 실패했습니다: ' + entry.id);
            state.managedHashes[entry.id] = entry.afterHash;
            state.managedCards[entry.id] = makeManagedCardSnapshot(item);
            if (isNativeSummary(item)) state.nativeHashes[entry.id] = entry.afterHash;
        });
        pending.deletes.forEach(function(entry) {
            if (byId.has(String(entry.id))) throw new Error('최종 DELETE 검증에 실패했습니다: ' + entry.id);
        });

        var handledIds = new Set(pending.patches.concat(pending.deletes).map(function(entry) { return String(entry.id); }));
        var patchedIdSet = new Set(pending.patches.map(function(entry) { return String(entry.id); }));
        state.pendingNativeIds = state.pendingNativeIds.filter(function(id) { return !handledIds.has(String(id)); });
        pending.recoveryIds.forEach(function(id) {
            if (patchedIdSet.has(String(id))) return;
            delete state.managedHashes[id];
            delete state.managedCards[id];
        });
        ['lastScheduleTurnKey', 'lastProcessedTurnKey', 'pendingCutoffTurnKey', 'observedNewTurns', 'openTailId', 'midSegmentIds', 'processedSinceMidMerge', 'forceFullCompact', 'fullBeforeRoutine', 'settingsSignature'].forEach(function(key) {
            if (Object.prototype.hasOwnProperty.call(pending.commit, key)) state[key] = pending.commit[key];
        });
        state.midSegmentIds = Array.from(new Set((state.midSegmentIds || []).map(String).filter(function(id) { return byId.has(id); })));
        if (state.openTailId && !byId.has(String(state.openTailId))) state.openTailId = state.midSegmentIds.length ? state.midSegmentIds[state.midSegmentIds.length - 1] : '';
        var shouldNotifyUpdate = !!pending.mutationStarted;
        var result = { patched:pending.patches.length, deleted:pending.deletes.length, deleteFailures:0, total:summaries.length };
        state.pendingApply = null;
        saveAutoMemoryState(chatId, state);
        if (shouldNotifyUpdate) showToast('요약 메모리가 업데이트되었습니다 · 수정 ' + result.patched + '개 · 삭제 ' + result.deleted + '개');
        return result;
    }

    async function discardPendingAutoApply(chatId, state) {
        var pending = state.pendingApply;
        if (!pending) return false;
        pending = validatePendingAutoApply(pending);
        if (pending.mutationStarted) {
            if (!renewAutoMemoryLock(chatId)) throw new Error('미완료 계획 정리 잠금을 잃어 중단했습니다.');
            var summaries = await fetchSummaries({ silent:true, strict:true, chatId:chatId });
            var byId = new Map(summaries.map(function(item) { return [String(getSummaryId(item) || ''), item]; }));
            pending.patches.forEach(function(entry) {
                var item = byId.get(String(entry.id));
                if (!item) throw new Error('변경이 시작된 PATCH 슬롯이 사라져 계획을 폐기할 수 없습니다: ' + entry.id);
                var fingerprint = summaryFingerprint(item);
                if (fingerprint !== entry.beforeHash && fingerprint !== entry.afterHash) throw new Error('외부 변경된 PATCH 슬롯 때문에 계획을 폐기할 수 없습니다: ' + entry.id);
                if (fingerprint === entry.afterHash) {
                    state.managedHashes[entry.id] = entry.afterHash;
                    state.managedCards[entry.id] = makeManagedCardSnapshot(item);
                    if (isNativeSummary(item)) state.nativeHashes[entry.id] = entry.afterHash;
                }
            });
            pending.deletes.forEach(function(entry) {
                var item = byId.get(String(entry.id));
                if (item && summaryFingerprint(item) !== entry.beforeHash) throw new Error('외부 변경된 DELETE 슬롯 때문에 계획을 폐기할 수 없습니다: ' + entry.id);
                if (!item) {
                    delete state.nativeHashes[entry.id];
                    delete state.managedHashes[entry.id];
                    delete state.managedCards[entry.id];
                }
            });
        }
        state.pendingApply = null;
        clearAutoMemoryFailure(state);
        state.lastStatus = '미완료 계획 폐기 · 같은 로그 재계획 대기';
        saveAutoMemoryState(chatId, state);
        return true;
    }

    function initializeAutoMemoryState(turns, summaries, state) {
        var latestKey = turns.length ? turns[turns.length - 1].key : '';
        state.initialized = true;
        state.lastScheduleTurnKey = latestKey;
        state.lastProcessedTurnKey = latestKey;
        state.pendingCutoffTurnKey = '';
        state.nativeHashes = {};
        state.managedHashes = {};
        state.managedCards = {};
        state.pendingNativeIds = [];
        state.pendingDeleteIds = [];
        state.pendingApply = null;
        state.waitingForSlot = false;
        state.openTailId = '';
        state.midSegmentIds = [];
        state.processedSinceMidMerge = 0;
        state.forceFullCompact = false;
        state.fullBeforeRoutine = false;
        state.needsV2InventoryMigration = false;
        syncAutoNativeState(summaries, state, true);
        adoptStableNativeSummaries(summaries, state, true);
        state.observedNewTurns = 0;
        state.lastStatus = '현재 대화를 기준점으로 저장함';
        state.lastError = '';
    }

    function prepareScheduledAutoBatch(turns, state, settings) {
        if (!turns.length) return { turns:[], waiting:true };
        if (state.pendingCutoffTurnKey) {
            var pendingIndex = findTurnIndex(turns, state.pendingCutoffTurnKey);
            var processedIndex = findTurnIndex(turns, state.lastProcessedTurnKey);
            if (pendingIndex < 0 || (state.lastProcessedTurnKey && processedIndex < 0)) throw new Error('대화 기준점이 조회 범위 밖으로 밀려났습니다. 기준점을 초기화해주세요.');
            var pendingTurns = turns.slice(processedIndex + 1, pendingIndex + 1);
            if (!pendingTurns.length) {
                state.pendingCutoffTurnKey = '';
                return { turns:[], waiting:true };
            }
            return { turns:pendingTurns.slice(0, settings.readTurns), waiting:false };
        }

        var scheduleIndex = findTurnIndex(turns, state.lastScheduleTurnKey);
        if (state.lastScheduleTurnKey && scheduleIndex < 0) throw new Error('실행 기준점이 조회 범위 밖으로 밀려났습니다. 기준점을 초기화해주세요.');
        var newTurns = turns.slice(scheduleIndex + 1);
        state.observedNewTurns = newTurns.length;
        if (newTurns.length < settings.intervalTurns) return { turns:[], waiting:true };

        state.lastScheduleTurnKey = turns[turns.length - 1].key;
        state.observedNewTurns = 0;
        var cutoffIndex = turns.length - 1 - settings.excludeRecentTurns;
        var processedAt = findTurnIndex(turns, state.lastProcessedTurnKey);
        if (cutoffIndex <= processedAt) return { turns:[], waiting:true };
        state.pendingCutoffTurnKey = turns[cutoffIndex].key;
        var eligible = turns.slice(processedAt + 1, cutoffIndex + 1);
        return { turns:eligible.slice(0, settings.readTurns), waiting:!eligible.length };
    }

    function prepareManualAutoBatch(turns, settings, state) {
        var cutoffIndex = turns.length - 1 - settings.excludeRecentTurns;
        if (cutoffIndex < 0) return [];
        if (state && state.lastProcessedTurnKey) {
            var processedIndex = findTurnIndex(turns, state.lastProcessedTurnKey);
            if (processedIndex < 0) throw new Error('처리 기준점이 조회 범위 밖으로 밀려났습니다. 기준점을 초기화해주세요.');
            var pendingEnd = state.pendingCutoffTurnKey ? findTurnIndex(turns, state.pendingCutoffTurnKey) : cutoffIndex;
            if (state.pendingCutoffTurnKey && pendingEnd < 0) throw new Error('보류 기준점이 조회 범위 밖으로 밀려났습니다. 기준점을 초기화해주세요.');
            pendingEnd = Math.min(cutoffIndex, pendingEnd);
            if (pendingEnd > processedIndex) return turns.slice(processedIndex + 1, Math.min(pendingEnd + 1, processedIndex + 1 + settings.readTurns));
        }
        var startIndex = Math.max(0, cutoffIndex - settings.readTurns + 1);
        return turns.slice(startIndex, cutoffIndex + 1);
    }

    function getAutoMemoryStatusText(chatId) {
        if (!chatId) return '채팅방에서만 작동함';
        var settings = getAutoMemorySettings(chatId);
        if (!settings.enabled) return '꺼짐 · 수동 요약은 기존대로 사용 가능';
        var state = getAutoMemoryState(chatId);
        if (state.autoPaused) return '3회 오류 누적 · 자동 일시정지 · 원인: ' + (state.lastError || '알 수 없음') + ' (설정 저장 또는 지금 실행으로 재개)';
        if (state.retryAfter > Date.now()) {
            var retryMinutes = Math.max(1, Math.ceil((state.retryAfter - Date.now()) / 60000));
            return retryMinutes + '분 후 자동 재시도 · ' + (state.lastError || state.lastStatus || '오류');
        }
        if (state.pendingApply) return '미완료 슬롯 저장 재개 대기 · ' + (state.lastError || state.lastStatus || '검증 중');
        if (state.lastError) return '오류 · ' + state.lastError;
        if (!state.initialized) return '첫 확인 대기 중';
        if (state.pendingCutoffTurnKey) return '요약 대기/처리 중 · ' + (state.lastStatus || '슬롯 확인 중');
        var remaining = Math.max(0, settings.intervalTurns - (state.observedNewTurns || 0));
        var suffix = state.lastSuccessAt ? ' · 마지막 ' + new Date(state.lastSuccessAt).toLocaleString() : '';
        return '다음 실행까지 ' + remaining + '대화턴' + suffix;
    }

    function clearAutoMemoryFailure(state) {
        state.consecutiveFailures = 0;
        state.retryAfter = 0;
        state.autoPaused = false;
        state.lastError = '';
    }

    function recordAutoMemoryFailure(state) {
        state.consecutiveFailures = Math.min(3, (Number(state.consecutiveFailures) || 0) + 1);
        if (state.consecutiveFailures >= 3) {
            state.retryAfter = 0;
            state.autoPaused = true;
            return;
        }
        state.retryAfter = Date.now() + AUTO_MEMORY_RETRY_DELAYS[state.consecutiveFailures - 1];
    }

    function isMidMergeDue(state, settings) {
        return settings.midMergeTurns > 0 && (Number(state.processedSinceMidMerge) || 0) >= settings.midMergeTurns;
    }

    function scheduleAutoMemoryMaintenanceIfNeeded(chatId, state, settings, totalCards) {
        if (!settings.enabled || getChatId() !== chatId) return;
        if (state.forceFullCompact || Number(totalCards) > settings.maxCards || (!state.pendingCutoffTurnKey && isMidMergeDue(state, settings))) scheduleAutoMemoryResponseCheck(300);
    }

    async function runAutoMemory(manual) {
        var chatId = getChatId();
        if (!chatId) return false;
        if (isAutoMemorySettingsEditPending(chatId)) {
            if (!manual) scheduleAutoMemoryResponseCheck(AUTO_MEMORY_SETTINGS_AUTOSAVE_MS + 100);
            return false;
        }
        var settings = getAutoMemorySettings(chatId);
        var settingsSignature = getAutoMemorySettingsSignature(settings);
        var lockHeartbeat = 0;
        if ((!manual && !settings.enabled) || AUTO_MEMORY_BUSY) return false;
        if (!acquireAutoMemoryLock(chatId)) {
            if (!manual && settings.enabled) scheduleAutoMemoryResponseCheck(15000);
            return false;
        }
        AUTO_MEMORY_BUSY = true;
        lockHeartbeat = setInterval(function() { renewAutoMemoryLock(chatId); }, AUTO_MEMORY_LOCK_HEARTBEAT_MS);
        var state = getAutoMemoryState(chatId);

        try {
            if (!state.settingsSignature) {
                if (state.initialized && !(state.pendingApply && state.pendingApply.mutationStarted)) {
                    state.pendingApply = null;
                    resetAutoMemoryPlanningForSettings(state, settingsSignature, chatId);
                    state.lastStatus = '자동 설정 저장 구조 갱신 · 현재 값으로 재계획';
                    saveAutoMemoryState(chatId, state);
                } else {
                    state.settingsSignature = settingsSignature;
                }
            } else if (state.settingsSignature !== settingsSignature && !(state.pendingApply && state.pendingApply.mutationStarted)) {
                state.pendingApply = null;
                resetAutoMemoryPlanningForSettings(state, settingsSignature, chatId);
                state.lastStatus = '저장된 자동 설정 변경 감지 · 최신 값으로 재계획';
                saveAutoMemoryState(chatId, state);
            }
            state.lastError = '';
            if (state.pendingApply) {
                var resumedPlanSettingsSignature = String(state.pendingApply.settingsSignature || settingsSignature);
                state.waitingForSlot = false;
                state.lastStatus = '미완료 슬롯 저장 재개 중';
                saveAutoMemoryState(chatId, state);
                var resumed = await resumePendingAutoApply(chatId, state, settings);
                if (resumed.replan) {
                    clearAutoMemoryFailure(state);
                    saveAutoMemoryState(chatId, state);
                    scheduleAutoMemoryResponseCheck(100);
                    return true;
                }
                if (finishAutoMemorySettingsTransition(chatId, state, resumedPlanSettingsSignature, '미완료 저장 완료 · 변경된 설정으로 다음 작업 재계획')) return true;
                clearAutoMemoryFailure(state);
                state.lastSuccessAt = Date.now();
                state.waitingForSlot = !!state.pendingCutoffTurnKey;
                state.lastStatus = '수정 ' + resumed.patched + '개 · 삭제 ' + resumed.deleted + '개 · 현재 ' + resumed.total + '개';
                saveAutoMemoryState(chatId, state);
                scheduleAutoMemoryMaintenanceIfNeeded(chatId, state, settings, resumed.total);
                if (state.pendingCutoffTurnKey) scheduleAutoMemoryResponseCheck(300);
                return true;
            }

            state.lastStatus = '대화와 슬롯 확인 중';
            saveAutoMemoryState(chatId, state);
            var messageLimit = Math.min(500, Math.max(100, (settings.intervalTurns + settings.readTurns + settings.excludeRecentTurns + 10) * 4));
            var messageOptions = { silent:true, strict:true, chatId:chatId };
            if (state.initialized) {
                messageLimit = 0;
                messageOptions.stopKeys = [state.lastScheduleTurnKey, state.lastProcessedTurnKey].filter(Boolean);
            }
            var messages = await fetchRecentMessageObjects(messageLimit, messageOptions);
            var turns = buildCompletedDialogueTurns(messages || []);
            if (!turns.length) {
                if (manual) throw new Error('완료된 사용자+AI 대화턴을 찾지 못했습니다.');
                state.waitingForSlot = false;
                state.lastStatus = '완료된 AI 답변 대기 중';
                clearAutoMemoryFailure(state);
                saveAutoMemoryState(chatId, state);
                return true;
            }
            var summaries = await fetchSummaries({ silent:true, strict:true, chatId:chatId });

            var initializedNow = false;
            if (!state.initialized) {
                var initialOverLimit = summaries.length > settings.maxCards;
                initializeAutoMemoryState(turns, summaries, state);
                initializedNow = true;
                clearAutoMemoryFailure(state);
                saveAutoMemoryState(chatId, state);
                if (!manual && !initialOverLimit) return true;
            } else {
                syncAutoNativeState(summaries, state, false);
                if (state.needsV2InventoryMigration && !state.pendingApply) adoptStableNativeSummaries(summaries, state, false);
            }
            if (summaries.length > settings.maxCards) state.forceFullCompact = true;
            saveAutoMemoryState(chatId, state);

            if (state.pendingDeleteIds.length) state.pendingDeleteIds = [];

            var batchTurns = [];
            var mode = '';
            var plan = null;
            if (manual && state.forceFullCompact) {
                plan = selectFullCompactPlan(summaries, state, settings);
                mode = 'full';
            } else if (manual) {
                batchTurns = prepareManualAutoBatch(turns, settings, state);
                if (!batchTurns.length) throw new Error('설정한 최근 제외 범위 뒤에 요약할 대화가 없습니다.');
                plan = selectRoutineAppendPlan(summaries, state, settings);
                if (plan) mode = 'routine';
            } else {
                var scheduled = prepareScheduledAutoBatch(turns, state, settings);
                batchTurns = scheduled.turns;
                if (state.forceFullCompact && state.fullBeforeRoutine) {
                    plan = selectFullCompactPlan(summaries, state, settings);
                    mode = 'full';
                    batchTurns = [];
                } else if (batchTurns.length) {
                    plan = selectRoutineAppendPlan(summaries, state, settings);
                    if (plan) mode = 'routine';
                    else if (state.forceFullCompact) {
                        plan = selectFullCompactPlan(summaries, state, settings);
                        mode = 'full';
                        batchTurns = [];
                    }
                } else if (state.forceFullCompact) {
                    plan = selectFullCompactPlan(summaries, state, settings);
                    mode = 'full';
                } else if (isMidMergeDue(state, settings)) {
                    plan = selectMidMergePlan(summaries, state, settings);
                    mode = 'mid';
                    if (!plan) {
                        state.processedSinceMidMerge = 0;
                        state.midSegmentIds = state.openTailId ? [String(state.openTailId)] : [];
                        state.waitingForSlot = false;
                        state.lastStatus = '중간 병합 대상이 2개 미만이라 비용 없이 건너뜀';
                        clearAutoMemoryFailure(state);
                        saveAutoMemoryState(chatId, state);
                        return true;
                    }
                } else {
                    state.waitingForSlot = false;
                    state.lastStatus = state.pendingCutoffTurnKey ? '요약할 슬롯 대기 중' : '다음 실행 대기 중';
                    clearAutoMemoryFailure(state);
                    saveAutoMemoryState(chatId, state);
                    return true;
                }
            }

            if (!plan) {
                if (mode === 'full' || state.forceFullCompact) throw new Error('보호된 카드만 남아 최대 슬롯 수를 맞출 수 없습니다.');
                state.waitingForSlot = !manual || settings.enabled;
                state.lastStatus = batchTurns.length + '대화턴 보류 · 수정할 마지막 카드 또는 새 assistant 슬롯 대기 중';
                clearAutoMemoryFailure(state);
                saveAutoMemoryState(chatId, state);
                if (manual) showToast('새 assistant 장기기억 슬롯이 없어 로그를 보류했습니다.');
                return true;
            }

            state.waitingForSlot = false;
            var runtime = getSavedAutoAiRuntime();
            var isCompaction = mode === 'mid' || mode === 'full';
            var inputPrompt = mode === 'routine' ? buildAutoAppendInput(plan, batchTurns) : buildAutoCompactionInput(plan);
            state.lastStatus = mode === 'routine'
                ? batchTurns.length + '대화턴 누적 정리 중'
                : (mode === 'mid' ? '최근 구간 중간 병합 중' : '최대 슬롯 초과 · 전체 2차 압축 중');
            saveAutoMemoryState(chatId, state);
            if (isAutoMemorySettingsEditPending(chatId) || !isAutoMemorySettingsSignatureCurrent(settingsSignature, chatId)) {
                resetAutoMemoryPlanningForSettings(state, '', chatId);
                state.lastStatus = '설정 변경 감지 · AI 호출 전 최신 값으로 재계획 대기';
                clearAutoMemoryFailure(state);
                saveAutoMemoryState(chatId, state);
                scheduleAutoMemoryResponseCheck(100);
                return true;
            }
            if (!renewAutoMemoryLock(chatId)) throw new Error('AI 호출 직전 자동 저장 잠금을 잃어 중단했습니다.');
            var rawResult = await callAI(
                runtime.provider,
                runtime.config,
                formatDialogueTurns(batchTurns),
                batchTurns.length,
                runtime.style,
                isCompaction,
                {
                    inputPrompt:inputPrompt,
                    promptMode:isCompaction ? 'compress' : 'auto',
                    jsonMode:mode === 'routine',
                    systemPrompt:getActivePromptText(isCompaction ? 'compress' : 'auto') + '\n\n' +
                        (mode === 'routine'
                            ? AUTO_MEMORY_APPEND_SYSTEM_REQUIREMENTS
                            : AUTO_MEMORY_SYSTEM_REQUIREMENTS + '\n\n' + AUTO_MEMORY_COMPACTION_REQUIREMENT)
                }
            );
            if (!renewAutoMemoryLock(chatId)) throw new Error('AI 호출 뒤 자동 저장 잠금을 잃어 저장을 중단했습니다.');
            recordAutoMemoryUsage(state, LAST_AI_USAGE);
            saveAutoMemoryState(chatId, state);
            if (isAutoMemorySettingsEditPending(chatId) || !isAutoMemorySettingsSignatureCurrent(settingsSignature, chatId)) {
                resetAutoMemoryPlanningForSettings(state, '', chatId);
                state.lastStatus = '설정 변경 감지 · AI 결과는 저장하지 않고 최신 값으로 재계획 대기';
                clearAutoMemoryFailure(state);
                saveAutoMemoryState(chatId, state);
                scheduleAutoMemoryResponseCheck(100);
                return true;
            }
            var commit;
            if (mode === 'routine') {
                var appendResult = validateAutoAppendResult(rawResult, plan);
                if (appendResult.waiting) {
                    state.waitingForSlot = true;
                    if (state.forceFullCompact) state.fullBeforeRoutine = true;
                    state.lastStatus = '독립 사건을 담을 새 슬롯 부족 · 현재 로그 전체 보류';
                    clearAutoMemoryFailure(state);
                    saveAutoMemoryState(chatId, state);
                    scheduleAutoMemoryMaintenanceIfNeeded(chatId, state, settings, summaries.length);
                    return true;
                }
                var routineMetadata = getRoutineCommitMetadata(state, plan, appendResult);
                if (state.forceFullCompact) routineMetadata.fullBeforeRoutine = true;
                routineMetadata.settingsSignature = settingsSignature;
                commit = createAutoApplyCommit(state, turns, batchTurns, manual, false, routineMetadata);
                state.pendingApply = createPendingAutoAppend(plan, appendResult, commit, settings);
            } else {
                var cards = validateAutoGeneratedCards(rawResult, plan.slotLimit, plan.expectedCount);
                var survivingIds = plan.rewriteSlots.slice(0, cards.length).map(function(item) { return String(getSummaryId(item) || ''); });
                var nextOpenTailId = mode === 'mid' && plan.openTailId ? plan.openTailId : (survivingIds.length ? survivingIds[survivingIds.length - 1] : '');
                commit = createAutoApplyCommit(state, turns, [], false, true, {
                    openTailId:nextOpenTailId,
                    midSegmentIds:nextOpenTailId ? [nextOpenTailId] : [],
                    processedSinceMidMerge:0,
                    forceFullCompact:mode === 'full' ? false : !!state.forceFullCompact,
                    fullBeforeRoutine:mode === 'full' ? false : !!state.fullBeforeRoutine,
                    settingsSignature:settingsSignature
                });
                state.pendingApply = createPendingAutoApply(plan, cards, commit, settings);
            }
            state.lastStatus = '저장 계획 기록 완료 · 슬롯 치환 및 검증 중';
            saveAutoMemoryState(chatId, state);
            var result = await resumePendingAutoApply(chatId, state, settings);
            if (result.replan) {
                clearAutoMemoryFailure(state);
                saveAutoMemoryState(chatId, state);
                scheduleAutoMemoryResponseCheck(100);
                return true;
            }
            if (finishAutoMemorySettingsTransition(chatId, state, settingsSignature, '슬롯 저장 완료 · 변경된 설정으로 다음 작업 재계획')) return true;

            state.lastSuccessAt = Date.now();
            state.waitingForSlot = !!state.pendingCutoffTurnKey;
            clearAutoMemoryFailure(state);
            state.lastStatus = (mode === 'routine' ? '누적 정리' : mode === 'mid' ? '중간 병합' : '전체 압축') +
                ' 완료 · 수정 ' + result.patched + '개 · 삭제 ' + result.deleted + '개 · 현재 ' + result.total + '개';
            saveAutoMemoryState(chatId, state);
            scheduleAutoMemoryMaintenanceIfNeeded(chatId, state, settings, result.total);
            if (state.pendingCutoffTurnKey) scheduleAutoMemoryResponseCheck(300);
            return true;
        } catch (err) {
            state.lastError = String(err && err.message || err || '알 수 없는 오류').slice(0, 500);
            if (!manual || settings.enabled) recordAutoMemoryFailure(state);
            state.lastStatus = state.autoPaused ? '오류 3회 누적으로 자동 일시정지' : '안전하게 중단됨';
            try { saveAutoMemoryState(chatId, state); } catch (saveError) { console.error('[AutoMemory] state save failed:', saveError); }
            console.error('[AutoMemory]', err);
            if (manual) await showUiAlert(state.lastError, '자동 장기기억 정리 오류', { tone:'danger' });
            return false;
        } finally {
            var settingsReplanRequested = consumeAutoMemorySettingsReplan(chatId);
            if (lockHeartbeat) clearInterval(lockHeartbeat);
            AUTO_MEMORY_BUSY = false;
            releaseAutoMemoryLock(chatId);
            notifyAutoMemoryStatus(chatId);
            var visibleChatId = getChatId();
            if (visibleChatId && visibleChatId !== chatId) notifyAutoMemoryStatus(visibleChatId);
            refreshAutoMemorySchedule(true);
            if (settingsReplanRequested) scheduleAutoMemoryResponseCheck(100);
        }
    }

    function clearAutoMemoryResponseTimer() {
        if (!AUTO_MEMORY_RESPONSE_TIMER) return;
        clearTimeout(AUTO_MEMORY_RESPONSE_TIMER);
        AUTO_MEMORY_RESPONSE_TIMER = 0;
    }

    function clearAutoMemorySlotTimer(resetBackoff) {
        if (AUTO_MEMORY_SLOT_TIMER) clearTimeout(AUTO_MEMORY_SLOT_TIMER);
        AUTO_MEMORY_SLOT_TIMER = 0;
        if (resetBackoff) AUTO_MEMORY_SLOT_RECHECK_INDEX = 0;
    }

    function clearAutoMemoryRetryTimer() {
        if (!AUTO_MEMORY_RETRY_TIMER) return;
        clearTimeout(AUTO_MEMORY_RETRY_TIMER);
        AUTO_MEMORY_RETRY_TIMER = 0;
    }

    function cancelAutoMemorySchedule() {
        clearAutoMemoryResponseTimer();
        clearAutoMemorySlotTimer(true);
        clearAutoMemoryRetryTimer();
    }

    function scheduleAutoMemoryResponseCheck(delay) {
        var chatId = getChatId();
        if (!chatId || !getAutoMemorySettings(chatId).enabled) return;
        clearAutoMemoryResponseTimer();
        AUTO_MEMORY_RESPONSE_TIMER = setTimeout(function() {
            AUTO_MEMORY_RESPONSE_TIMER = 0;
            if (getChatId() !== chatId) {
                refreshAutoMemorySchedule(true);
                return;
            }
            pollAutoMemory();
        }, Math.max(0, Number(delay) || 0));
    }

    function hasAutoMemorySlotChange(summaries, state) {
        return (summaries || []).filter(isNativeSummary).some(function(item) {
            var id = String(getSummaryId(item) || '');
            if (!id) return false;
            var fingerprint = summaryFingerprint(item);
            return !Object.prototype.hasOwnProperty.call(state.nativeHashes, id) || state.nativeHashes[id] !== fingerprint;
        });
    }

    async function probeWaitingAutoMemorySlot(expectedChatId) {
        AUTO_MEMORY_SLOT_TIMER = 0;
        var chatId = getChatId();
        if (expectedChatId && chatId !== expectedChatId) {
            clearAutoMemorySlotTimer(true);
            refreshAutoMemorySchedule(true);
            return;
        }
        var settings = getAutoMemorySettings(chatId);
        if (!settings.enabled || !chatId) {
            clearAutoMemorySlotTimer(true);
            return;
        }
        var state = getAutoMemoryState(chatId);
        if (!state.waitingForSlot || !state.pendingCutoffTurnKey || state.autoPaused) {
            clearAutoMemorySlotTimer(true);
            return;
        }
        if (state.retryAfter > Date.now()) {
            refreshAutoMemorySchedule(false);
            return;
        }
        if (AUTO_MEMORY_BUSY) {
            AUTO_MEMORY_SLOT_TIMER = setTimeout(function() { probeWaitingAutoMemorySlot(chatId); }, 1500);
            return;
        }
        try {
            var summaries = await fetchSummaries({ silent:true, strict:true, chatId:chatId });
            if (hasAutoMemorySlotChange(summaries, state)) {
                AUTO_MEMORY_SLOT_RECHECK_INDEX = 0;
                await runAutoMemory(false);
                refreshAutoMemorySchedule(false);
                return;
            }
        } catch (err) {
            console.warn('[AutoMemory] slot probe failed:', err);
        }
        scheduleWaitingAutoMemorySlotCheck(false);
    }

    function scheduleWaitingAutoMemorySlotCheck(resetBackoff) {
        if (resetBackoff) clearAutoMemorySlotTimer(true);
        if (AUTO_MEMORY_SLOT_TIMER) return;
        var chatId = getChatId();
        var settings = getAutoMemorySettings(chatId);
        if (!settings.enabled || !chatId) return;
        var state = getAutoMemoryState(chatId);
        if (!state.waitingForSlot || !state.pendingCutoffTurnKey || state.autoPaused || state.retryAfter > Date.now()) return;
        var delayIndex = Math.min(AUTO_MEMORY_SLOT_RECHECK_INDEX, AUTO_MEMORY_SLOT_RECHECK_DELAYS.length - 1);
        var delay = AUTO_MEMORY_SLOT_RECHECK_DELAYS[delayIndex];
        AUTO_MEMORY_SLOT_RECHECK_INDEX = Math.min(delayIndex + 1, AUTO_MEMORY_SLOT_RECHECK_DELAYS.length - 1);
        AUTO_MEMORY_SLOT_TIMER = setTimeout(function() { probeWaitingAutoMemorySlot(chatId); }, delay);
    }

    function scheduleAutoMemoryRetry(retryAfter) {
        clearAutoMemoryRetryTimer();
        var chatId = getChatId();
        if (!chatId) return;
        var delay = Math.max(50, Number(retryAfter) - Date.now() + 50);
        AUTO_MEMORY_RETRY_TIMER = setTimeout(function() {
            AUTO_MEMORY_RETRY_TIMER = 0;
            if (getChatId() !== chatId) {
                refreshAutoMemorySchedule(true);
                return;
            }
            pollAutoMemory();
        }, delay);
    }

    function refreshAutoMemorySchedule(resetSlotBackoff) {
        var chatId = getChatId();
        var settings = getAutoMemorySettings(chatId);
        if (!settings.enabled || !chatId) {
            cancelAutoMemorySchedule();
            return;
        }
        var state = getAutoMemoryState(chatId);
        if (state.autoPaused) {
            clearAutoMemorySlotTimer(true);
            clearAutoMemoryRetryTimer();
            return;
        }
        if (state.retryAfter > Date.now()) {
            clearAutoMemorySlotTimer(false);
            scheduleAutoMemoryRetry(state.retryAfter);
            return;
        }
        clearAutoMemoryRetryTimer();
        if (state.pendingApply) {
            clearAutoMemorySlotTimer(true);
            scheduleAutoMemoryResponseCheck(250);
            return;
        }
        if (state.waitingForSlot && state.pendingCutoffTurnKey) {
            scheduleWaitingAutoMemorySlotCheck(!!resetSlotBackoff);
            return;
        }
        clearAutoMemorySlotTimer(true);
    }

    function isAutoMemoryResponseNode(node, includeDescendants) {
        var element = node && node.nodeType === 1 ? node : node && node.parentElement;
        if (!element || !element.closest) return false;
        if (element.closest('.crack-ext-ai-overlay,#crack-ext-toast,.crack-ext-header-ai-btn')) return false;
        var selector = '.wrtn-markdown,[data-role="assistant"],[data-message-author-role="assistant"],[data-testid*="assistant"]';
        if (element.matches && element.matches(selector)) return true;
        if (element.closest(selector)) return true;
        return !!(includeDescendants && element.querySelector && element.querySelector(selector));
    }

    function mutationTouchesAutoMemoryResponse(mutation) {
        if (!mutation || (mutation.type !== 'childList' && mutation.type !== 'characterData')) return false;
        if (isAutoMemoryResponseNode(mutation.target, false)) return true;
        for (var i = 0; i < mutation.addedNodes.length; i++) {
            if (isAutoMemoryResponseNode(mutation.addedNodes[i], true)) return true;
        }
        return false;
    }

    function wakeAutoMemoryOnReturn() {
        if (document.visibilityState === 'hidden') return;
        var now = Date.now();
        if (now - AUTO_MEMORY_LAST_WAKE_AT < AUTO_MEMORY_WAKE_THROTTLE_MS) return;
        AUTO_MEMORY_LAST_WAKE_AT = now;
        scheduleAutoMemoryResponseCheck(300);
    }

    function pollAutoMemory() {
        var chatId = getChatId();
        if (!chatId || !getAutoMemorySettings(chatId).enabled) {
            cancelAutoMemorySchedule();
            return false;
        }
        if (AUTO_MEMORY_BUSY) {
            scheduleAutoMemoryResponseCheck(3000);
            return false;
        }
        var state = getAutoMemoryState(chatId);
        if (state.autoPaused) {
            refreshAutoMemorySchedule(false);
            return false;
        }
        if (state.retryAfter > Date.now()) {
            refreshAutoMemorySchedule(false);
            return false;
        }
        return runAutoMemory(false);
    }

    function showMemoryEditorModal(parentOverlay) {
        var overlay = document.createElement('div');
        overlay.className = 'crack-ext-ai-overlay';
        overlay.innerHTML = '<div class="crack-ext-ai-modal crack-ext-editor-modal">' +
            '<div class="crack-ext-ai-modal-header"><h3><span class="crack-ext-head-glyph" aria-hidden="true">' + UI_ICONS.edit + '</span><span class="crack-ext-head-title">장기기억 일괄 편집</span></h3><div class="crack-ext-ai-modal-header-actions"><span id="ce-editor-total" style="font-size:11px;color:#888;">불러오는 중...</span><button class="crack-ext-ai-close-btn" id="ce-editor-x-close" type="button" aria-label="창 닫기" title="창 닫기">' + UI_ICONS.close + '</button></div></div>' +
            '<div class="crack-ext-editor-toolbar">' +
              '<div class="crack-ext-editor-search-row">' +
                '<input id="ce-editor-search" type="text" placeholder="제목 또는 내용 검색">' +
                '<label class="crack-ext-editor-check-label"><input id="ce-editor-changed-only" type="checkbox"><span>변경된 항목만</span></label>' +
                '<label class="crack-ext-editor-check-label"><input id="ce-editor-select-all" type="checkbox"><span>전체 선택</span></label>' +
                '<div class="crack-ext-editor-bulk-actions">' +
                  '<button class="crack-ext-ai-mbtn crack-ext-editor-danger crack-ext-editor-restore" id="ce-editor-delete-selected" disabled>선택 삭제</button>' +
                  '<button class="crack-ext-ai-mbtn crack-ext-editor-restore" id="ce-editor-restore-selected" disabled>선택 원복</button>' +
                  '<button class="crack-ext-ai-mbtn crack-ext-editor-restore" id="ce-editor-reset-all">전체 원복</button>' +
                '</div>' +
              '</div>' +
              '<div id="ce-editor-summary" style="font-size:11px;color:#777;margin-top:8px;">선택 0개 · 수정 0개 · 삭제 0개</div>' +
            '</div>' +
            '<div class="crack-ext-editor-list" id="ce-editor-list"><div class="crack-ext-editor-empty">장기기억을 불러오는 중...</div></div>' +
            '<div class="crack-ext-ai-modal-btns" style="position:sticky;bottom:-24px;background:inherit;padding:12px 0 0;z-index:3;">' +
              '<div class="crack-ext-ai-footer-right"><button class="crack-ext-ai-mbtn" id="ce-editor-back">돌아가기</button><button class="crack-ext-ai-mbtn crack-ext-ai-mbtn-p" id="ce-editor-save" disabled>' + UI_ICONS.save + '<span>변경사항 저장</span></button></div>' +
            '</div></div>';
        document.body.appendChild(overlay);

        var listEl = overlay.querySelector('#ce-editor-list');
        var searchEl = overlay.querySelector('#ce-editor-search');
        var changedOnlyEl = overlay.querySelector('#ce-editor-changed-only');
        var selectAllEl = overlay.querySelector('#ce-editor-select-all');
        var deleteSelectedBtn = overlay.querySelector('#ce-editor-delete-selected');
        var restoreSelectedBtn = overlay.querySelector('#ce-editor-restore-selected');
        var summaryEl = overlay.querySelector('#ce-editor-summary');
        var totalEl = overlay.querySelector('#ce-editor-total');
        var saveBtn = overlay.querySelector('#ce-editor-save');
        var xCloseBtn = overlay.querySelector('#ce-editor-x-close');
        var backBtn = overlay.querySelector('#ce-editor-back');
        var resetAllBtn = overlay.querySelector('#ce-editor-reset-all');
        var items = [];
        var saving = false;

        function hasUnsaved() { return items.some(function(x) { return x.changed || x.deletePending; }); }
        async function exitEditor(returnToMain) {
            if (saving) return;
            var warning = returnToMain ? '저장하지 않은 변경사항이 있습니다. 메인 화면으로 돌아갈까요?' : '저장하지 않은 변경사항이 있습니다. 창을 닫을까요?';
            if (hasUnsaved() && !(await showUiConfirm(warning, '저장하지 않은 변경사항', { confirmText:returnToMain ? '돌아가기' : '닫기', tone:'warning' }))) return;
            overlay.remove();
            if (returnToMain) {
                if (parentOverlay && parentOverlay.isConnected) parentOverlay.style.display = 'flex';
                else showMainModal();
            } else {
                if (parentOverlay && parentOverlay.isConnected) parentOverlay.remove();
                releaseVertexSessionSecrets();
            }
        }
        xCloseBtn.onclick = function() { exitEditor(false); };
        backBtn.onclick = function() { exitEditor(true); };
        overlay.addEventListener('click', function(e) { if (e.target === overlay) exitEditor(false); });

        function countText(item) {
            return '제목 ' + item.title.length + '/20자 · 내용 ' + item.summary.length + '/300자';
        }
        function isInvalid(item) {
            return !item.deletePending && (!item.title.trim() || !item.summary.trim() || item.title.length > 20 || item.summary.length > 300);
        }
        function refreshState(item) {
            item.changed = item.title !== item.originalTitle || item.summary !== item.originalSummary;
        }
        function getVisibleItems() {
            var q = searchEl.value.trim().toLowerCase();
            var changedOnly = changedOnlyEl.checked;
            return items.filter(function(item) {
                if (changedOnly && !item.changed && !item.deletePending) return false;
                if (!q) return true;
                return (item.title + '\n' + item.summary + '\n' + item.originalTitle + '\n' + item.originalSummary).toLowerCase().includes(q);
            });
        }
        function updateSummaryBar(visible) {
            visible = visible || getVisibleItems();
            var selected = items.filter(function(x) { return x.selected; }).length;
            var changed = items.filter(function(x) { return x.changed && !x.deletePending; }).length;
            var deleted = items.filter(function(x) { return x.deletePending; }).length;
            var invalid = items.filter(isInvalid).length;
            summaryEl.textContent = '선택 ' + selected + '개 · 수정 ' + changed + '개 · 삭제 ' + deleted + '개' + (invalid ? ' · 오류 ' + invalid + '개' : '');
            saveBtn.disabled = (changed + deleted === 0) || invalid > 0 || saving;
            saveBtn.innerHTML = UI_ICONS.save + '<span>' + (saving ? '저장 중...' : '변경사항 저장 (' + (changed + deleted) + ')') + '</span>';
            deleteSelectedBtn.disabled = selected === 0 || saving;
            restoreSelectedBtn.disabled = selected === 0 || saving;

            var visibleSelected = visible.filter(function(x) { return x.selected; }).length;
            selectAllEl.checked = visible.length > 0 && visibleSelected === visible.length;
            selectAllEl.indeterminate = visibleSelected > 0 && visibleSelected < visible.length;
            selectAllEl.disabled = visible.length === 0 || saving;
        }

        function render() {
            var visible = getVisibleItems();
            listEl.innerHTML = '';
            if (!visible.length) {
                listEl.innerHTML = '<div class="crack-ext-editor-empty">표시할 장기기억이 없습니다.</div>';
                updateSummaryBar(visible);
                return;
            }
            visible.forEach(function(item) {
                var card = document.createElement('div');
                card.className = 'crack-ext-editor-card' + (item.changed ? ' is-changed' : '') + (item.deletePending ? ' is-delete' : '') + (isInvalid(item) ? ' is-error' : '') + (item.selected ? ' is-selected' : '');
                card.dataset.key = item.key;
                card.innerHTML = '<div class="crack-ext-editor-card-head">' +
                    '<div class="crack-ext-editor-card-title">' +
                      '<label class="crack-ext-editor-check-label"><input class="ce-editor-item-select" type="checkbox" ' + (item.selected ? 'checked' : '') + '><span>선택</span></label>' +
                      '<div class="crack-ext-editor-index">#' + (item.index + 1) + ' <span class="crack-ext-editor-status">' + (item.deletePending ? '삭제 예정' : item.changed ? '수정됨' : '원본') + '</span></div>' +
                    '</div>' +
                    '<div class="crack-ext-editor-actions"><button class="crack-ext-ai-mbtn crack-ext-editor-restore" data-act="restore">원본 복원</button><button class="crack-ext-ai-mbtn crack-ext-editor-danger crack-ext-editor-restore" data-act="delete">' + (item.deletePending ? '삭제 취소' : '삭제') + '</button></div></div>' +
                    '<div class="crack-ext-editor-grid">' +
                      '<div class="crack-ext-editor-pane"><h4>변경 전</h4><div class="crack-ext-editor-original"><strong>[' + escapeHtml(item.originalTitle) + ']</strong>\n' + escapeHtml(item.originalSummary) + '</div></div>' +
                      '<div class="crack-ext-editor-pane"><h4>변경 후</h4><input class="crack-ext-editor-title-input" value="' + escapeHtml(item.title) + '" ' + (item.deletePending ? 'disabled' : '') + '><textarea class="crack-ext-editor-summary-input" ' + (item.deletePending ? 'disabled' : '') + '>' + escapeHtml(item.summary) + '</textarea><div class="crack-ext-editor-meta"><span class="count">' + countText(item) + '</span><span>' + (isInvalid(item) ? '빈칸 또는 글자 수 초과' : '') + '</span></div></div>' +
                    '</div>';

                var itemSelect = card.querySelector('.ce-editor-item-select');
                var titleInput = card.querySelector('.crack-ext-editor-title-input');
                var summaryInput = card.querySelector('.crack-ext-editor-summary-input');
                itemSelect.addEventListener('change', function() {
                    item.selected = itemSelect.checked;
                    card.classList.toggle('is-selected', item.selected);
                    updateSummaryBar(visible);
                });
                function onInput() {
                    item.title = titleInput.value;
                    item.summary = summaryInput.value;
                    refreshState(item);
                    card.querySelector('.count').textContent = countText(item);
                    card.classList.toggle('is-changed', item.changed);
                    card.classList.toggle('is-error', isInvalid(item));
                    card.querySelector('.crack-ext-editor-status').textContent = item.changed ? '수정됨' : '원본';
                    card.querySelector('.crack-ext-editor-meta span:last-child').textContent = isInvalid(item) ? '빈칸 또는 글자 수 초과' : '';
                    updateSummaryBar(visible);
                }
                titleInput.addEventListener('input', onInput);
                summaryInput.addEventListener('input', onInput);
                card.querySelector('[data-act="restore"]').onclick = function() {
                    item.title = item.originalTitle;
                    item.summary = item.originalSummary;
                    item.deletePending = false;
                    refreshState(item);
                    render();
                };
                card.querySelector('[data-act="delete"]').onclick = async function() {
                    if (!item.deletePending && !(await showUiConfirm('이 장기기억을 삭제 예정으로 표시할까요?\n실제 삭제는 아래 변경사항 저장을 눌렀을 때 실행됩니다.', '장기기억 삭제', { confirmText:'삭제 예정', danger:true }))) return;
                    item.deletePending = !item.deletePending;
                    render();
                };
                listEl.appendChild(card);
            });
            updateSummaryBar(visible);
        }

        // 검색 입력 중에는 카드 전체 재렌더링을 잠깐 묶어서 불필요한 DOM 작업을 줄인다.
        var editorSearchRenderTimer = 0;
        searchEl.addEventListener('input', function() {
            clearTimeout(editorSearchRenderTimer);
            editorSearchRenderTimer = setTimeout(function() {
                if (overlay.isConnected) render();
            }, 120);
        });
        changedOnlyEl.addEventListener('change', render);
        selectAllEl.addEventListener('change', function() {
            var visible = getVisibleItems();
            var checked = selectAllEl.checked;
            visible.forEach(function(item) { item.selected = checked; });
            render();
        });
        deleteSelectedBtn.onclick = async function() {
            var selected = items.filter(function(item) { return item.selected; });
            if (!selected.length) return;
            if (!(await showUiConfirm('선택한 ' + selected.length + '개 항목을 삭제 예정으로 표시할까요?\n실제 삭제는 변경사항 저장 시 실행됩니다.', '선택 항목 삭제', { confirmText:'삭제 예정', danger:true }))) return;
            selected.forEach(function(item) {
                item.deletePending = true;
                item.selected = false;
            });
            render();
        };
        restoreSelectedBtn.onclick = function() {
            var selected = items.filter(function(item) { return item.selected; });
            if (!selected.length) return;
            selected.forEach(function(item) {
                item.title = item.originalTitle;
                item.summary = item.originalSummary;
                item.deletePending = false;
                item.selected = false;
                refreshState(item);
            });
            render();
        };
        resetAllBtn.onclick = async function() {
            if (!hasUnsaved()) return;
            if (!(await showUiConfirm('모든 수정과 삭제 예정을 원본으로 되돌릴까요?', '전체 원복', { confirmText:'원복', tone:'warning' }))) return;
            items.forEach(function(item) {
                item.title = item.originalTitle;
                item.summary = item.originalSummary;
                item.deletePending = false;
                item.selected = false;
                refreshState(item);
            });
            render();
        };

        saveBtn.onclick = async function() {
            var targets = items.filter(function(x) { return x.deletePending || x.changed; });
            if (!targets.length) return;
            if (targets.some(isInvalid)) { await showUiAlert('빈칸이 있거나 글자 수 제한을 넘긴 항목이 있습니다.', '저장할 수 없음', { tone:'warning' }); return; }
            var delCount = targets.filter(function(x) { return x.deletePending; }).length;
            if (!(await showUiConfirm('수정 ' + (targets.length - delCount) + '개, 삭제 ' + delCount + '개를 저장할까요?', '변경사항 저장', { confirmText:'저장', danger:delCount > 0 }))) return;
            saving = true;
            updateSummaryBar();
            var success = 0;
            var failed = [];
            for (var i = 0; i < targets.length; i++) {
                var item = targets[i];
                saveBtn.innerHTML = UI_ICONS.save + '<span>저장 중... (' + (i + 1) + '/' + targets.length + ')</span>';
                try {
                    if (item.deletePending) {
                        await deleteExistingSummary(item.raw);
                        item.savedDeleted = true;
                    } else {
                        await updateExistingSummary(item.raw, item.title.trim(), item.summary.trim());
                    }
                    success++;
                    item.selected = false;
                    if (!item.deletePending) {
                        item.originalTitle = item.title.trim();
                        item.originalSummary = item.summary.trim();
                        item.title = item.originalTitle;
                        item.summary = item.originalSummary;
                        item.changed = false;
                    }
                } catch (err) {
                    failed.push((item.originalTitle || '제목 없음') + ': ' + err.message);
                }
            }
            if (success) {
                items = items.filter(function(item) { return !item.savedDeleted; });
                items.forEach(function(item, index) { item.index = index; delete item.savedDeleted; });
                totalEl.textContent = '총 ' + items.length + '개';
                showToast('수정/삭제 ' + success + '개가 저장되었습니다.');
            }
            if (failed.length) await showUiAlert('일부 항목 저장 실패:\n\n' + failed.join('\n'), '일부 저장 실패', { tone:'danger' });
            saving = false;
            if (success && !failed.length) {
                var fresh = await fetchSummaries();
                items = (fresh || []).map(function(raw, index) {
                    var title = raw.title || '';
                    var summary = raw.summary || '';
                    return {raw:raw, key:String(getSummaryId(raw) || index), index:index, originalTitle:title, originalSummary:summary, title:title, summary:summary, changed:false, deletePending:false, selected:false};
                });
                totalEl.textContent = '총 ' + items.length + '개';
                render();
                var dialogEl = document.querySelector('[role="dialog"]');
                if (dialogEl) refreshCurrentTab(dialogEl);
            } else {
                render();
            }
        };

        fetchSummaries().then(function(summaries) {
            items = (summaries || []).map(function(raw, index) {
                var title = raw.title || '';
                var summary = raw.summary || '';
                return {raw:raw, key:String(getSummaryId(raw) || index), index:index, originalTitle:title, originalSummary:summary, title:title, summary:summary, changed:false, deletePending:false, selected:false};
            });
            totalEl.textContent = '총 ' + items.length + '개';
            render();
        }).catch(function(err) {
            listEl.innerHTML = '<div class="crack-ext-editor-empty">불러오기 실패: ' + escapeHtml(err.message) + '</div>';
        });
    }

    // ============== 2차 압축 모달 ==============
    function showCompressModal(parentOverlay) {
        var overlay = document.createElement('div');
        overlay.className = 'crack-ext-ai-overlay';

        var html = '<div class="crack-ext-ai-modal crack-ext-compress-modal" style="width:600px;">';
        html += '<div class="crack-ext-ai-modal-header"><h3><span class="crack-ext-head-glyph" aria-hidden="true">' + UI_ICONS.flask + '</span><span class="crack-ext-head-title">장기기억 2차 압축</span></h3><div class="crack-ext-ai-modal-header-actions"><span class="crack-ext-badge crack-ext-badge-compress">검색형 압축</span><button class="crack-ext-ai-close-btn" id="ce-compress-x-close" type="button" aria-label="창 닫기" title="창 닫기">' + UI_ICONS.close + '</button></div></div>';
        html += '<div class="crack-ext-compress-header"><span>압축할 장기기억을 선택하세요 (여러 개 선택 가능)</span><button class="crack-ext-ai-mbtn" id="ce-compress-select-all" style="font-size:11px;padding:4px 10px;">전체 선택</button></div>';
        html += '<div class="crack-ext-compress-list" id="ce-compress-list"><div style="text-align:center;padding:20px;color:#999;">불러오는 중...</div></div>';
        html += '<div class="crack-ext-compress-note" style="margin-top:8px;font-size:11px;color:#888;">' + UI_ICONS.info + '<span>선택한 항목들을 2차 압축 프롬프트로 병합·압축합니다. 원본은 유지됩니다.</span></div>';
        html += '<div class="crack-ext-ai-modal-btns">';
        html += '<div class="crack-ext-ai-footer-right"><button class="crack-ext-ai-mbtn" id="ce-compress-back">돌아가기</button><button class="crack-ext-ai-mbtn crack-ext-ai-mbtn-p" id="ce-compress-start" disabled>' + UI_ICONS.flask + '<span>압축 생성</span></button></div>';
        html += '</div></div>';

        overlay.innerHTML = html;
        document.body.appendChild(overlay);

        var listContainer = overlay.querySelector('#ce-compress-list');
        var btnStart = overlay.querySelector('#ce-compress-start');
        var btnSelectAll = overlay.querySelector('#ce-compress-select-all');
        var btnBack = overlay.querySelector('#ce-compress-back');
        var btnXClose = overlay.querySelector('#ce-compress-x-close');
        var allSummaries = [];
        var allSelected = false;

        function returnToMain() {
            overlay.remove();
            if (parentOverlay && parentOverlay.isConnected) parentOverlay.style.display = 'flex';
            else showMainModal();
        }
        function closeAll() {
            overlay.remove();
            if (parentOverlay && parentOverlay.isConnected) parentOverlay.remove();
            releaseVertexSessionSecrets();
        }
        btnBack.onclick = returnToMain;
        btnXClose.onclick = closeAll;
        overlay.addEventListener('click', function(e) { if (e.target === overlay) closeAll(); });

        fetchSummaries().then(summaries => {
            allSummaries = summaries;
            if (!allSummaries || allSummaries.length === 0) {
                listContainer.innerHTML = '<div style="text-align:center;padding:20px;color:#999;">장기기억이 없습니다.</div>';
                return;
            }
            renderList();
        });

        function renderList() {
            listContainer.innerHTML = '';
            allSummaries.forEach((s, i) => {
                if (!s.title || s.title === 'undefined') return;
                if (!s.summary || s.summary.trim() === '') return;
                if (/^[가-힣]{2,4}\s*\(.*\)$/.test(s.title) && s.title.length < 15) return;

                var div = document.createElement('div');
                div.className = 'crack-ext-compress-item';
                div.innerHTML = '<input type="checkbox" data-index="' + i + '"><div style="flex:1;"><div class="item-title">[' + escapeHtml(s.title) + ']</div><div class="item-summary">' + escapeHtml(s.summary || '') + '</div></div>';
                div.addEventListener('click', function(e) {
                    if (e.target.tagName === 'INPUT') return;
                    var cb = div.querySelector('input');
                    cb.checked = !cb.checked;
                    updateButton();
                });
                listContainer.appendChild(div);
            });
            updateButton();
        }

        function getSelected() {
            var checked = [];
            listContainer.querySelectorAll('input:checked').forEach(cb => {
                var idx = parseInt(cb.dataset.index);
                if (!isNaN(idx) && allSummaries[idx]) checked.push(allSummaries[idx]);
            });
            return checked;
        }

        function updateButton() {
            btnStart.disabled = getSelected().length === 0;
            btnStart.innerHTML = UI_ICONS.flask + '<span>압축 생성 (' + getSelected().length + '개 선택)</span>';
        }

        listContainer.addEventListener('change', updateButton);

        btnSelectAll.onclick = () => {
            allSelected = !allSelected;
            listContainer.querySelectorAll('input').forEach(cb => { cb.checked = allSelected; });
            btnSelectAll.textContent = allSelected ? '전체 해제' : '전체 선택';
            updateButton();
        };

        btnStart.onclick = async () => {
            var selected = getSelected();
            if (selected.length === 0) { await showUiAlert('압축할 항목을 선택해주세요.', '선택 필요', { tone:'warning' }); return; }

            var combinedText = selected.map(s => '[' + s.title + ']\n' + (s.summary || '') + '\n').join('\n---\n\n');
// 메인 모달에서 선택된 모델 즉시 저장
var mainModel = document.getElementById('ce-ai-model');
var mainProvider = document.getElementById('ce-ai-provider');
if (mainModel && mainProvider) {
    localStorage.setItem('crack_ext_api_provider', mainProvider.value);
    localStorage.setItem('crack_ext_' + mainProvider.value + '_model', mainModel.value);
}
            var provider = localStorage.getItem('crack_ext_api_provider') || 'google';
            var model = localStorage.getItem('crack_ext_' + provider + '_model') || getDefaultModel(provider);
            var apiKey = getSavedApiKey(provider);
            var firebaseScript = localStorage.getItem('crack_ext_firebase_script') || '';
            var vertexJson = getSavedVertexJson();
            var vertexLocation = getSavedVertexLocation();
            var vertexProjectId = getSavedVertexProjectId();
            var reasoning = localStorage.getItem(getReasoningStorageKey(provider, model)) || 'auto';

            btnStart.disabled = true;
            btnStart.innerHTML = UI_ICONS.flask + '<span>압축 중...</span>';

            try {
                var config = {
                    apiKey:apiKey,
                    model:model,
                    firebaseScript:firebaseScript,
                    vertexJson:vertexJson,
                    vertexLocation:vertexLocation,
                    vertexProjectId:vertexProjectId,
                    reasoning:reasoning
                };
                var result = await callAI(provider, config, combinedText, 0, 'concise', true);
                var finalized = await finalizeGeneratedMemoryResult(provider, config, result, true);
                releaseVertexSessionSecrets();
                overlay.remove();
                if (parentOverlay && parentOverlay.isConnected) parentOverlay.remove();
                showMainModal(finalized.text, true);
            } catch (err) {
                await showUiAlert('압축 중 오류: ' + err.message, '압축 오류', { tone:'danger' });
                btnStart.disabled = false;
                btnStart.innerHTML = UI_ICONS.flask + '<span>압축 생성</span>';
            }
        };
    }

    // ============== 메인 모달 ==============
    function showMainModal(prefillText, isCompressResult) {
        var modalChatId = getChatId();
        var restoredDraft = null;
        if (!String(prefillText || '').trim()) {
            restoredDraft = getAiResultDraft();
            if (restoredDraft) {
                prefillText = restoredDraft.text;
                isCompressResult = restoredDraft.mode === 'compress';
            }
        }
        var overlay = document.createElement('div');
        overlay.className = 'crack-ext-ai-overlay';

        var savedProvider = localStorage.getItem('crack_ext_api_provider') || 'google';
        var savedFirebaseScript = localStorage.getItem('crack_ext_firebase_script') || '';
        var savedVertexLocation = getSavedVertexLocation();
        var savedVertexProjectId = getSavedVertexProjectId();
        var savedTurns = localStorage.getItem('crack_ext_turn_count') || '15';
        var savedStyle = localStorage.getItem('crack_ext_summary_style') || 'concise';
        var currentKey = getSavedApiKey(savedProvider);
        var autoSettings = getAutoMemorySettings(modalChatId);

        var isPromptMode = false;
        var tempResultContent = '';
        var parsedCards = [];
        var currentCardIndex = 0;
        var isGenerating = false;
        var promptMode = isCompressResult ? 'compress' : 'main';
        var resultMode = isCompressResult ? 'compress' : 'main';
        var editingSlotId = null;

        var html = '<div class="crack-ext-ai-modal crack-ext-main-modal">';
        html += '<div class="crack-ext-ai-modal-header"><h3><span class="crack-ext-head-glyph" aria-hidden="true">' + UI_ICONS.memory + '</span><span class="crack-ext-head-title">AI 요약 / 장기 기억 추가' + (isCompressResult ? ' <span class="crack-ext-badge crack-ext-badge-compress">2차 압축 결과</span>' : '') + '</span></h3><div class="crack-ext-ai-modal-header-actions"><button class="crack-ext-ai-close-btn" id="ce-ai-x-close" type="button" aria-label="창 닫기" title="창 닫기">' + UI_ICONS.close + '</button></div></div>';

        html += '<div class="crack-flex-ai-row" id="ce-ai-top-settings">';
        html += '<div class="fg ce-ai-provider-field" style="flex:1.2;"><label>API</label><select id="ce-ai-provider">' +
            '<option value="google"' + (savedProvider === 'google' ? ' selected' : '') + '>Google</option>' +
            '<option value="vertex"' + (savedProvider === 'vertex' ? ' selected' : '') + '>Vertex JSON</option>' +
            '<option value="deepseek"' + (savedProvider === 'deepseek' ? ' selected' : '') + '>DeepSeek</option>' +
            '<option value="openai"' + (savedProvider === 'openai' ? ' selected' : '') + '>OpenAI</option>' +
            '<option value="firebase"' + (savedProvider === 'firebase' ? ' selected' : '') + '>Firebase</option>' +
            '</select></div>';
        html += '<div class="fg" id="ce-ai-key-wrap" style="flex:2;' + (savedProvider === 'firebase' || savedProvider === 'vertex' ? 'display:none' : '') + '"><label>API Key</label><input type="password" id="ce-ai-key" value="' + escapeHtml(currentKey) + '"></div>';
        html += '<div class="fg" id="ce-ai-firebase-wrap" style="flex:2;' + (savedProvider === 'firebase' ? '' : 'display:none') + '"><label>Firebase Script</label><input type="text" id="ce-ai-firebase-script" value=""></div>';
        html += '<div class="fg ce-ai-model-field" style="flex:1.5;"><label>모델</label><select id="ce-ai-model"></select></div>';
        html += '<div class="fg crack-ext-turn-field" style="flex:.8;">' +
    '<label class="crack-ext-turn-label">' +
        '<span>턴 수</span>' +
        '<button type="button" class="crack-ext-turn-info-btn" id="ce-ai-turn-info" aria-label="턴 수 계산 안내" aria-expanded="false">' + UI_ICONS.info + '</button>' +
    '</label>' +
    '<input type="number" id="ce-ai-turns" value="' + escapeHtml(savedTurns) + '" min="0">' +
    '<div class="crack-ext-turn-info-popover" id="ce-ai-turn-info-popover" hidden>' +
        '<strong>사용자 1 + LLM 1 = 총 2턴</strong>' +
        '<span>일반적인 대화 30턴을 원하면 <b>60턴</b>으로 설정하세요.</span>' +
    '</div>' +
'</div>';
        html += '</div>';

        html += '<div id="ce-ai-vertex-wrap"' + (savedProvider === 'vertex' ? '' : ' style="display:none"') + '>';
        html += '<div class="fg"><label>서비스 계정 JSON</label>';
        html += '<div class="crack-ext-vertex-credential-actions"><span class="crack-ext-vertex-status" id="ce-ai-vertex-status"></span><button class="crack-ext-ai-mbtn crack-ext-vertex-small-btn" id="ce-ai-vertex-use" type="button">JSON 입력 (세션)</button><button class="crack-ext-ai-mbtn crack-ext-vertex-small-btn" id="ce-ai-vertex-save" type="button">JSON 저장/교체</button><button class="crack-ext-ai-mbtn crack-ext-vertex-small-btn" id="ce-ai-vertex-clear" type="button">저장 삭제</button></div>';
        html += '</div>';
        html += '<div class="crack-ext-vertex-meta">';
        html += '<div class="fg"><label>Location</label><input type="text" id="ce-ai-vertex-location" spellcheck="false" placeholder="global"></div>';
        html += '<div class="fg"><label>Project ID (선택)</label><input type="text" id="ce-ai-vertex-project" spellcheck="false" placeholder="JSON의 project_id 자동 사용"></div>';
        html += '</div>';
        html += '<div class="crack-ext-vertex-note">JSON은 사이트 DOM이 아닌 브라우저 입력창에서 받으며 원문을 다시 표시하지 않습니다. 세션 입력은 창을 닫을 때 폐기되고, 저장/교체는 userscript의 GM 저장소에 보관합니다. 기본 Location은 global이며 Project ID를 비우면 JSON 값을 사용합니다. Gemini 3 계열은 global로 자동 연결됩니다.</div>';
        html += '</div>';

        html += '<div class="crack-flex-ai-row" id="ce-ai-secondary-settings">';
        html += '<div class="fg" style="flex:1;"><label>요약 스타일</label><select id="ce-ai-style"><option value="concise"' + (savedStyle === 'concise' ? ' selected' : '') + '>간결</option><option value="detailed"' + (savedStyle === 'detailed' ? ' selected' : '') + '>상세</option></select></div>';
        html += '<div class="fg" style="flex:1;"><label>추론</label><select id="ce-ai-reasoning"></select></div>';
        html += '<div class="fg" style="flex:2;"><label>내보내기</label><div class="crack-ext-export-actions">' +
            '<button class="crack-ext-export-btn" data-export="txt">TXT</button>' +
            '<button class="crack-ext-export-btn" data-export="json">JSON</button>' +
            '<button class="crack-ext-export-btn" data-export="md">Markdown</button>' +
            '</div></div>';
        html += '</div>';

        html += '<details class="crack-ext-auto-panel" id="ce-auto-panel"' + (autoSettings.enabled ? ' open' : '') + '>';
        html += '<summary><span>자동 장기기억 정리</span><span class="crack-ext-auto-summary-status" id="ce-auto-summary-status">' + escapeHtml(getAutoMemoryStatusText(modalChatId)) + '</span></summary>';
        html += '<div class="crack-ext-auto-body">';
        html += '<div class="crack-ext-auto-toggle-row">';
        html += '<label class="crack-ext-auto-check"><input type="checkbox" id="ce-auto-enabled"' + (autoSettings.enabled ? ' checked' : '') + '><span>자동 정리 사용</span></label>';
        html += '<label class="crack-ext-auto-check"><input type="checkbox" id="ce-auto-protect"' + (autoSettings.protectUserAdded ? ' checked' : '') + '><span>[추가] 카드 보호</span></label>';
        html += '</div>';
        html += '<div class="crack-ext-auto-grid">';
        html += '<div class="crack-ext-auto-field"><label for="ce-auto-interval">실행 주기 (대화턴)</label><input type="number" id="ce-auto-interval" min="1" max="50" value="' + autoSettings.intervalTurns + '"></div>';
        html += '<div class="crack-ext-auto-field"><label for="ce-auto-read">한 번에 읽을 대화턴</label><input type="number" id="ce-auto-read" min="1" max="50" value="' + autoSettings.readTurns + '"></div>';
        html += '<div class="crack-ext-auto-field"><label for="ce-auto-exclude">최근 제외 (대화턴)</label><input type="number" id="ce-auto-exclude" min="0" max="10" value="' + autoSettings.excludeRecentTurns + '"></div>';
        html += '<div class="crack-ext-auto-field"><label for="ce-auto-context">참고 장기기억</label><input type="number" id="ce-auto-context" min="3" max="5" value="' + autoSettings.contextCards + '"></div>';
        html += '<div class="crack-ext-auto-field"><label for="ce-auto-mid-merge">중간 병합 주기 (처리턴)</label><input type="number" id="ce-auto-mid-merge" min="0" max="500" value="' + autoSettings.midMergeTurns + '" title="0이면 중간 병합을 끕니다."></div>';
        html += '<div class="crack-ext-auto-field"><label for="ce-auto-max">최대 슬롯</label><input type="number" id="ce-auto-max" min="5" max="20" value="' + autoSettings.maxCards + '"></div>';
        html += '<div class="crack-ext-auto-field"><label for="ce-auto-target">전체 압축 목표 슬롯</label><input type="number" id="ce-auto-target" min="1" max="' + autoSettings.maxCards + '" value="' + autoSettings.compactTarget + '"></div>';
        html += '</div>';
        html += '<div class="crack-ext-auto-note">자동 정리 사용 여부와 아래 숫자 설정은 현재 채팅방별로 따로 저장됩니다. 대화턴 1개 = 사용자 1회 + AI 답변 1회입니다. 평상시에는 오래된 카드를 유지하고, 마지막 카드의 직접 후속만 수정하며, 독립 사건은 새 assistant 슬롯에 누적합니다. 새 슬롯이 없으면 로그를 버리거나 옛 카드에 밀어 넣지 않고 보류합니다. “중간 병합 주기”마다 최근 누적 구간만 2차 압축 지침에 따라 필요한 만큼 병합하며, 0이면 끕니다. 전체 카드가 최대 슬롯을 초과한 순간에만 압축 목표 슬롯까지 전체 정리합니다. 아래 “자동 정리” 프롬프트는 평상시 누적 판단에, “2차 압축” 프롬프트는 중간·전체 압축에 사용됩니다. 최근 제외는 마지막 경계를 다음 실행으로 보류합니다. [추가] 카드 보호를 켜면 해당 카드는 절대 수정·삭제하지 않습니다. assistant 슬롯만 치환·삭제하며 새 [추가] 카드는 만들지 않습니다.</div>';
        html += '<div class="crack-ext-auto-actions"><button class="crack-ext-ai-mbtn" id="ce-auto-save-settings">설정 저장</button><button class="crack-ext-ai-mbtn" id="ce-auto-run">지금 실행</button><button class="crack-ext-ai-mbtn" id="ce-auto-reset">기준점 초기화</button><span class="crack-ext-auto-status" id="ce-auto-status"></span></div>';
        html += '<div class="crack-ext-auto-usage" id="ce-auto-usage"></div>';
        html += '</div></details>';

        html += '<div class="fg">';
        html += '<div class="crack-ext-prompt-header" id="ce-ai-prompt-header">';
        html += '<div class="crack-ext-prompt-heading"><div class="crack-ext-result-title-row"><span class="crack-ext-prompt-heading-main" id="ce-ai-result-label">생성 결과</span><span class="crack-ext-reasoning-usage" id="ce-ai-reasoning-usage"></span></div><span class="crack-ext-prompt-heading-sub">생성 형식은 선택한 프롬프트만 따름 · 저장 한도 초과 항목은 직접 수정</span></div>';
        html += '<div class="crack-ext-prompt-edit-actions">';
        html += '<button id="ce-ai-add-prompt" class="crack-ext-ai-mbtn crack-ext-prompt-icon-btn" type="button" title="새 슬롯 추가" aria-label="새 슬롯 추가">＋</button>';
        html += '<button id="ce-ai-rename-prompt" class="crack-ext-ai-mbtn crack-ext-prompt-icon-btn" type="button" title="슬롯 이름 변경" aria-label="슬롯 이름 변경"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>';
        html += '<button id="ce-ai-default-prompt" class="crack-ext-ai-mbtn crack-ext-prompt-icon-btn" type="button" title="기본 프롬프트 불러오기" aria-label="기본 프롬프트 불러오기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/></svg></button>';
        html += '<button id="ce-ai-delete-prompt" class="crack-ext-ai-mbtn crack-ext-prompt-icon-btn is-delete" type="button" title="슬롯 삭제" aria-label="슬롯 삭제"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg></button>';
        html += '<button id="ce-ai-save-prompt" class="crack-ext-ai-mbtn crack-ext-prompt-icon-btn is-save" type="button" title="슬롯 저장" aria-label="슬롯 저장"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v15H5Z"/><path d="M8 3v6h8V3"/><path d="M8 15h8v6H8Z"/></svg></button>';
        html += '</div>';
        html += '<div class="crack-ext-prompt-selects">';
        html += '<span id="ce-ai-selection-counter" style="color:#a777e3;font-size:11px;align-self:center;"></span>';
        html += '<div class="crack-ext-prompt-field"><span class="crack-ext-prompt-field-label">프롬프트 종류</span><select id="ce-ai-prompt-mode"><option value="main"' + (promptMode === 'main' ? ' selected' : '') + '>1차 요약</option><option value="auto"' + (promptMode === 'auto' ? ' selected' : '') + '>자동 정리</option><option value="compress"' + (promptMode === 'compress' ? ' selected' : '') + '>2차 압축</option></select></div>';
        html += '<div class="crack-ext-prompt-field"><span class="crack-ext-prompt-field-label">슬롯</span><select id="ce-ai-prompt-slot"></select></div>';
        html += '<button id="ce-ai-toggle-prompt" class="crack-ext-ai-mbtn crack-ext-prompt-tool-btn">프롬프트 편집</button>';
        html += '</div></div>';
        html += '<textarea id="ce-ai-result" rows="8" placeholder="생성 버튼을 누르면 요약 결과가 나옵니다.">' + (prefillText ? escapeHtml(prefillText) : '') + '</textarea>';
        html += '<div id="ce-ai-preview-container">';
        html += '<div id="ce-ai-card-nav" style="display:none;"><button id="ce-ai-card-prev">이전</button><span id="ce-ai-card-page">1/1</span><button id="ce-ai-card-next">다음</button></div>';
        html += '<div id="ce-ai-preview-cards"></div>';
        html += '</div></div>';

        html += '<div class="crack-ext-ai-modal-btns" id="ce-ai-main-footer">';
        html += '<div id="ce-ai-main-actions" style="display:flex;gap:8px;flex-wrap:wrap;"><button class="crack-ext-ai-mbtn" id="ce-ai-generate">' + UI_ICONS.sparkle + '<span>요약 생성</span></button><button class="crack-ext-ai-mbtn" id="ce-ai-compress-btn">' + UI_ICONS.flask + '<span>2차 압축</span></button><button class="crack-ext-ai-mbtn" id="ce-ai-memory-edit-btn">' + UI_ICONS.edit + '<span>장기기억 편집</span></button></div>';
        html += '<div class="crack-ext-ai-footer-right"><button class="crack-ext-ai-mbtn" id="ce-ai-prompt-back" style="display:none;">돌아가기</button><button class="crack-ext-ai-mbtn crack-ext-ai-mbtn-p" id="ce-ai-save">' + UI_ICONS.plus + '<span>추가하기</span></button></div>';
        html += '</div></div>';

        overlay.innerHTML = html;
        document.body.appendChild(overlay);

        var txtResult = overlay.querySelector('#ce-ai-result');
        var resultLabel = overlay.querySelector('#ce-ai-result-label');
        var reasoningUsageEl = overlay.querySelector('#ce-ai-reasoning-usage');
        var selCounter = overlay.querySelector('#ce-ai-selection-counter');
        var previewCards = overlay.querySelector('#ce-ai-preview-cards');
        var cardNav = overlay.querySelector('#ce-ai-card-nav');
        var spanCardPage = overlay.querySelector('#ce-ai-card-page');
        var btnCardPrev = overlay.querySelector('#ce-ai-card-prev');
        var btnCardNext = overlay.querySelector('#ce-ai-card-next');
        var btnSave = overlay.querySelector('#ce-ai-save');
        var btnGen = overlay.querySelector('#ce-ai-generate');
        var btnCompress = overlay.querySelector('#ce-ai-compress-btn');
        var btnMemoryEdit = overlay.querySelector('#ce-ai-memory-edit-btn');
        var btnXClose = overlay.querySelector('#ce-ai-x-close');
        var btnTogglePrompt = overlay.querySelector('#ce-ai-toggle-prompt');
        var btnPromptBack = overlay.querySelector('#ce-ai-prompt-back');
        var promptHeader = overlay.querySelector('#ce-ai-prompt-header');
        var mainActions = overlay.querySelector('#ce-ai-main-actions');
        var mainFooter = overlay.querySelector('#ce-ai-main-footer');
        var btnSavePrompt = overlay.querySelector('#ce-ai-save-prompt');
        var btnAddPrompt = overlay.querySelector('#ce-ai-add-prompt');
        var btnRenamePrompt = overlay.querySelector('#ce-ai-rename-prompt');
        var btnDeletePrompt = overlay.querySelector('#ce-ai-delete-prompt');
        var btnDefaultPrompt = overlay.querySelector('#ce-ai-default-prompt');
        var selPromptMode = overlay.querySelector('#ce-ai-prompt-mode');
        var selPromptSlot = overlay.querySelector('#ce-ai-prompt-slot');
        var selProvider = overlay.querySelector('#ce-ai-provider');
        var selModel = overlay.querySelector('#ce-ai-model');
        var selStyle = overlay.querySelector('#ce-ai-style');
        var selReasoning = overlay.querySelector('#ce-ai-reasoning');
        var inputKey = overlay.querySelector('#ce-ai-key');
        var inputFirebase = overlay.querySelector('#ce-ai-firebase-script');
        var inputVertexLocation = overlay.querySelector('#ce-ai-vertex-location');
        var inputVertexProject = overlay.querySelector('#ce-ai-vertex-project');
        var vertexCredentialStatus = overlay.querySelector('#ce-ai-vertex-status');
        var btnVertexUse = overlay.querySelector('#ce-ai-vertex-use');
        var btnVertexSave = overlay.querySelector('#ce-ai-vertex-save');
        var btnVertexClear = overlay.querySelector('#ce-ai-vertex-clear');
        var inputTurns = overlay.querySelector('#ce-ai-turns');
        var btnTurnInfo = overlay.querySelector('#ce-ai-turn-info');
        var turnInfoPopover = overlay.querySelector('#ce-ai-turn-info-popover');
        var keyWrap = overlay.querySelector('#ce-ai-key-wrap');
        var firebaseWrap = overlay.querySelector('#ce-ai-firebase-wrap');
        var vertexWrap = overlay.querySelector('#ce-ai-vertex-wrap');
        var topSettings = overlay.querySelector('#ce-ai-top-settings');
        var secondarySettings = overlay.querySelector('#ce-ai-secondary-settings');
        var autoPanel = overlay.querySelector('#ce-auto-panel');
        var autoEnabled = overlay.querySelector('#ce-auto-enabled');
        var autoProtect = overlay.querySelector('#ce-auto-protect');
        var autoInterval = overlay.querySelector('#ce-auto-interval');
        var autoRead = overlay.querySelector('#ce-auto-read');
        var autoExclude = overlay.querySelector('#ce-auto-exclude');
        var autoContext = overlay.querySelector('#ce-auto-context');
        var autoMidMerge = overlay.querySelector('#ce-auto-mid-merge');
        var autoMax = overlay.querySelector('#ce-auto-max');
        var autoTarget = overlay.querySelector('#ce-auto-target');
        var autoStatus = overlay.querySelector('#ce-auto-status');
        var autoSummaryStatus = overlay.querySelector('#ce-auto-summary-status');
        var autoUsage = overlay.querySelector('#ce-auto-usage');
        var btnAutoSaveSettings = overlay.querySelector('#ce-auto-save-settings');
        var btnAutoRun = overlay.querySelector('#ce-auto-run');
        var btnAutoReset = overlay.querySelector('#ce-auto-reset');
        var autoSettingsSaveTimer = 0;
        var autoSettingsDirty = false;
        var autoSettingsDirtyFields = new Set();
        var autoSettingsSaveLabelTimer = 0;
        var autoSettingsStorageHandler = null;
        // 턴 수 안내 팝업
if (btnTurnInfo && turnInfoPopover) {
    btnTurnInfo.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();

        var willOpen = turnInfoPopover.hidden;
        turnInfoPopover.hidden = !willOpen;
        btnTurnInfo.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });

    turnInfoPopover.addEventListener('click', function(e) {
        e.stopPropagation();
    });

    overlay.addEventListener('click', function() {
        if (!turnInfoPopover.hidden) {
            turnInfoPopover.hidden = true;
            btnTurnInfo.setAttribute('aria-expanded', 'false');
        }
    });
}

        // 저장된 Firebase 코드는 HTML 속성에 끼워 넣지 않고 DOM 값으로 복원한다.
        // 설정 안의 큰따옴표가 value 속성을 중간에서 닫아 내용을 잘라먹는 문제를 방지한다.
        inputFirebase.value = savedFirebaseScript;
        inputVertexLocation.value = savedVertexLocation;
        inputVertexProject.value = savedVertexProjectId;
        updateModelOptions(savedProvider);
        if (prefillText && LAST_AI_USAGE) { reasoningUsageEl.textContent = formatReasoningUsage(LAST_AI_USAGE); reasoningUsageEl.title = getUsageTooltip(LAST_AI_USAGE); }

        function updateReasoningUsage(meta, working) {
            reasoningUsageEl.textContent = meta ? formatReasoningUsage(meta) : '';
            reasoningUsageEl.title = meta ? getUsageTooltip(meta) : '';
            reasoningUsageEl.classList.toggle('is-working', !!working);
        }

        function updateVertexCredentialStatus(message, tone) {
            var availableJson = getSavedVertexJson();
            var isPersistent = VERTEX_SESSION_JSON !== null ? VERTEX_SESSION_PERSISTED : hasPersistentVertexJson();
            vertexCredentialStatus.classList.toggle('is-saved', tone === 'saved' || (!message && !!availableJson));
            vertexCredentialStatus.classList.toggle('is-error', tone === 'error');
            vertexCredentialStatus.textContent = message || (availableJson
                ? (isPersistent ? '✓ JSON 저장됨 · 원문은 표시하지 않음' : '✓ 현재 세션 JSON 사용 가능')
                : '저장된 Vertex JSON 없음');
            btnVertexClear.disabled = !availableJson && !isPersistent;
        }

        function commitVertexJsonInput(persist, showSuccessToast, rawOverride) {
            var rawJson = String(rawOverride || '').trim() || getSavedVertexJson();
            if (!rawJson) throw new Error('서비스 계정 JSON을 입력해주세요.');
            parseVertexServiceAccount(rawJson);
            var persisted = saveVertexJson(rawJson, persist !== false);
            VERTEX_TOKEN_CACHE.clear();
            updateVertexCredentialStatus(
                persist !== false && persisted ? '✓ JSON 저장됨 · 원문은 표시하지 않음' : '✓ 현재 세션에서만 JSON 사용',
                'saved'
            );
            if (showSuccessToast) showToast(persist !== false && persisted ? 'Vertex JSON을 안전 저장소에 저장했습니다.' : 'Vertex JSON을 현재 세션에 등록했습니다.');
            return { json:rawJson, persisted:persisted };
        }

        updateVertexCredentialStatus();

        async function requestVertexJson(persist) {
            var rawJson = window.prompt(
                persist ? '영구 저장할 Google Cloud 서비스 계정 JSON 전체를 붙여넣으세요.' : '이번 창에서만 사용할 Google Cloud 서비스 계정 JSON 전체를 붙여넣으세요.',
                ''
            );
            if (rawJson === null) return null;
            try {
                var result = commitVertexJsonInput(persist, true, rawJson);
                if (persist && !result.persisted) {
                    await showUiAlert('GM 저장소를 사용할 수 없어 이 창 세션에만 보관합니다.', '세션 보관', { tone:'warning' });
                }
                return result;
            } catch (err) {
                updateVertexCredentialStatus('JSON 확인 필요: ' + err.message, 'error');
                await showUiAlert(err.message, 'Vertex JSON 오류', { tone:'danger' });
                return null;
            }
        }
        btnVertexUse.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            requestVertexJson(false);
        };
        btnVertexSave.onclick = async function(e) {
            e.preventDefault();
            e.stopPropagation();
            await requestVertexJson(true);
        };
        btnVertexClear.onclick = async function(e) {
            e.preventDefault();
            e.stopPropagation();
            var confirmed = await showUiConfirm('저장된 Vertex 서비스 계정 JSON과 현재 토큰을 삭제할까요?', 'Vertex JSON 삭제', { confirmText:'삭제', danger:true });
            if (!confirmed) return;
            var clearedPersistently = deleteVertexJson();
            VERTEX_TOKEN_CACHE.clear();
            updateVertexCredentialStatus(clearedPersistently ? '저장된 Vertex JSON을 삭제했습니다.' : '현재 세션의 Vertex JSON을 삭제했습니다.', '');
            if (!clearedPersistently && hasPersistentVertexJson()) {
                await showUiAlert('GM 저장소에서 JSON을 삭제하지 못했습니다. userscript 관리자 저장소를 확인해주세요.', '삭제 실패', { tone:'danger' });
            }
        };

        function getSelectedPromptSlot() {
            var slots = loadPromptSlots(promptMode);
            return slots.find(function(slot) { return slot.id === selPromptSlot.value; }) || getActivePromptSlot(promptMode);
        }

        function getEditingPromptSlot() {
            if (!editingSlotId) return null;
            return loadPromptSlots(promptMode).find(function(slot) { return slot.id === editingSlotId; }) || null;
        }

        function hasUnsavedPromptText() {
            if (!isPromptMode) return false;
            var slot = getEditingPromptSlot();
            return !!slot && txtResult.value !== slot.prompt;
        }

        async function confirmDiscardPromptEdit() {
            return !hasUnsavedPromptText() || await showUiConfirm('저장하지 않은 프롬프트 수정이 있습니다. 변경 내용을 버릴까요?', '프롬프트 변경사항', { confirmText:'버리기', danger:true });
        }

        function renderPromptSlots(preferredId) {
            var slots = loadPromptSlots(promptMode);
            var active = getActivePromptSlot(promptMode);
            var selectedId = preferredId || active.id;
            if (!slots.some(function(slot) { return slot.id === selectedId; })) selectedId = slots[0].id;
            selPromptSlot.innerHTML = '';
            slots.forEach(function(slot) {
                var opt = document.createElement('option');
                opt.value = slot.id;
                opt.textContent = slot.name;
                if (slot.id === selectedId) opt.selected = true;
                selPromptSlot.appendChild(opt);
            });
            setActivePromptSlot(promptMode, selectedId);
            btnDeletePrompt.disabled = slots.length <= 1;
        }

        function setPromptEditUi(enabled) {
            isPromptMode = enabled;
            if (!enabled) editingSlotId = null;
            resultLabel.textContent = enabled ? '프롬프트 슬롯 편집' : '생성 결과';
            reasoningUsageEl.style.display = enabled ? 'none' : 'inline';
            promptHeader.classList.toggle('is-editing', enabled);
            btnTogglePrompt.style.display = enabled ? 'none' : 'inline-block';
            btnPromptBack.style.display = enabled ? 'inline-block' : 'none';
            topSettings.style.display = enabled ? 'none' : '';
            secondarySettings.style.display = enabled ? 'none' : '';
            autoPanel.style.display = enabled ? 'none' : '';
            vertexWrap.style.display = enabled ? 'none' : (selProvider.value === 'vertex' ? 'grid' : 'none');
            mainActions.style.display = enabled ? 'none' : 'flex';
            mainFooter.classList.toggle('is-prompt-editing', enabled);
            btnSave.style.display = enabled ? 'none' : 'block';
            updatePreviewCards();
        }

        renderPromptSlots();

        var activeCredentialProvider = savedProvider;
        function saveVisibleCredentials(providerOverride) {
            var provider = providerOverride || activeCredentialProvider || selProvider.value;
            if (provider === 'firebase') {
                var firebaseValue = inputFirebase.value || '';
                if ((localStorage.getItem('crack_ext_firebase_script') || '') !== firebaseValue) {
                    localStorage.setItem('crack_ext_firebase_script', firebaseValue);
                }
            } else if (provider === 'vertex') {
                var vertexLocationValue = inputVertexLocation.value.trim() || 'global';
                var vertexProjectValue = inputVertexProject.value.trim();
                if (getSavedVertexLocation() !== vertexLocationValue || getSavedVertexProjectId() !== vertexProjectValue) {
                    saveVertexEndpointSettings(vertexLocationValue, vertexProjectValue);
                }
            } else {
                var apiKeyValue = inputKey.value || '';
                if (getSavedApiKey(provider) !== apiKeyValue) {
                    saveApiKey(provider, apiKeyValue);
                }
            }
        }
        function bindAutoSave(input, handler) {
            ['input','change','keyup','blur'].forEach(function(eventName) { input.addEventListener(eventName, handler); });
            input.addEventListener('paste', function() { setTimeout(handler, 0); setTimeout(handler, 120); });
        }
        bindAutoSave(inputKey, function() { saveVisibleCredentials(activeCredentialProvider); });
        bindAutoSave(inputFirebase, function() {
            var firebaseValue = inputFirebase.value || '';
            if ((localStorage.getItem('crack_ext_firebase_script') || '') !== firebaseValue) {
                localStorage.setItem('crack_ext_firebase_script', firebaseValue);
            }
        });
        bindAutoSave(inputVertexLocation, function() { saveVisibleCredentials('vertex'); });
        bindAutoSave(inputVertexProject, function() { saveVisibleCredentials('vertex'); });

        selProvider.onchange = async function() {
            var requestedProvider = selProvider.value;
            if (activeCredentialProvider === 'vertex' && requestedProvider !== 'vertex') VERTEX_TOKEN_CACHE.clear();
            saveVisibleCredentials(activeCredentialProvider);
            var provider = requestedProvider;
            activeCredentialProvider = provider;
            localStorage.setItem('crack_ext_api_provider', provider);
            if (provider === 'firebase') {
                keyWrap.style.display = 'none';
                firebaseWrap.style.display = 'block';
                vertexWrap.style.display = 'none';
                inputFirebase.value = localStorage.getItem('crack_ext_firebase_script') || '';
            } else if (provider === 'vertex') {
                keyWrap.style.display = 'none';
                firebaseWrap.style.display = 'none';
                vertexWrap.style.display = 'grid';
                inputVertexLocation.value = getSavedVertexLocation();
                inputVertexProject.value = getSavedVertexProjectId();
                updateVertexCredentialStatus();
            } else {
                keyWrap.style.display = 'block';
                firebaseWrap.style.display = 'none';
                vertexWrap.style.display = 'none';
                inputKey.value = getSavedApiKey(provider);
            }
            updateModelOptions(provider);
            updateReasoningUsage(null, false);
        };

        // 비밀번호 관리자 자동완성처럼 input 이벤트가 발생하지 않는 경우도 주기적으로 동기화한다.
        var credentialSyncTimer = setInterval(function() {
            if (!overlay.isConnected) { clearInterval(credentialSyncTimer); return; }
            saveVisibleCredentials(activeCredentialProvider);
        }, 700);
        setTimeout(function() { if (overlay.isConnected) saveVisibleCredentials(activeCredentialProvider); }, 250);
        setTimeout(function() { if (overlay.isConnected) saveVisibleCredentials(activeCredentialProvider); }, 1000);
        selModel.addEventListener('change', function() {
            localStorage.setItem('crack_ext_' + selProvider.value + '_model', selModel.value);
            updateReasoningOptions(selProvider.value, selModel.value);
            updateReasoningUsage(null, false);
        });
        selReasoning.addEventListener('change', function() {
            localStorage.setItem(getReasoningStorageKey(selProvider.value, selModel.value), selReasoning.value);
            updateReasoningUsage({
                provider:selProvider.value,
                model:selModel.value,
                requested:selReasoning.value,
                requestedLabel:getReasoningOptionLabel(selProvider.value, selModel.value, selReasoning.value),
                reasoningTokens:null,
                totalTokens:null
            }, false);
        });
        selStyle.addEventListener('change', function() {
            localStorage.setItem('crack_ext_summary_style', selStyle.value);
        });

        function readAutoInteger(input, min, max) {
            var raw = String(input && input.value != null ? input.value : '').trim();
            if (!/^-?\d+$/.test(raw)) return null;
            var value = Number(raw);
            if (!Number.isSafeInteger(value) || value < min || value > max) return null;
            return value;
        }

        function readAutoSettingsFromUi() {
            var intervalTurns = readAutoInteger(autoInterval, 1, 50);
            var readTurns = readAutoInteger(autoRead, 1, 50);
            var excludeRecentTurns = readAutoInteger(autoExclude, 0, 10);
            var contextCards = readAutoInteger(autoContext, 3, 5);
            var midMergeTurns = readAutoInteger(autoMidMerge, 0, 500);
            var maxCards = readAutoInteger(autoMax, 5, 20);
            if ([intervalTurns, readTurns, excludeRecentTurns, contextCards, midMergeTurns, maxCards].some(function(value) { return value == null; })) return null;
            var compactTarget = readAutoInteger(autoTarget, 1, maxCards);
            if (compactTarget == null) return null;
            return getNormalizedAutoMemorySettings({
                enabled:autoEnabled.checked,
                intervalTurns:intervalTurns,
                readTurns:readTurns,
                excludeRecentTurns:excludeRecentTurns,
                contextCards:contextCards,
                midMergeTurns:midMergeTurns,
                maxCards:maxCards,
                compactTarget:compactTarget,
                protectUserAdded:autoProtect.checked
            });
        }

        function writeAutoSettingsToUi(settings) {
            autoEnabled.checked = settings.enabled;
            autoProtect.checked = settings.protectUserAdded;
            autoInterval.value = settings.intervalTurns;
            autoRead.value = settings.readTurns;
            autoExclude.value = settings.excludeRecentTurns;
            autoContext.value = settings.contextCards;
            autoMidMerge.value = settings.midMergeTurns;
            autoMax.value = settings.maxCards;
            autoTarget.max = settings.maxCards;
            autoTarget.value = settings.compactTarget;
        }

        function syncAutoTargetLimit() {
            var maxCards = readAutoInteger(autoMax, 5, 20);
            if (maxCards == null) return false;
            autoTarget.max = maxCards;
            var target = readAutoInteger(autoTarget, 1, 20);
            if (target != null && target > maxCards) {
                autoTarget.value = maxCards;
                return true;
            }
            return false;
        }

        function renderAutoMemoryStatus() {
            var state = getAutoMemoryState(modalChatId);
            var text = getAutoMemoryStatusText(modalChatId);
            var routeChanged = !!modalChatId && getChatId() !== modalChatId;
            if (routeChanged) text = '다른 채팅방으로 이동함 · 이 창을 닫고 다시 열어주세요';
            autoStatus.textContent = text;
            autoSummaryStatus.textContent = text;
            autoUsage.textContent = formatAutoMemoryUsage(state);
            autoUsage.title = getAutoMemoryUsageTooltip(state);
            btnAutoRun.disabled = AUTO_MEMORY_BUSY || !modalChatId || routeChanged;
            btnAutoSaveSettings.disabled = AUTO_MEMORY_BUSY || !modalChatId || routeChanged;
            btnAutoReset.disabled = AUTO_MEMORY_BUSY || !modalChatId || routeChanged;
            [autoEnabled, autoProtect, autoInterval, autoRead, autoExclude, autoContext, autoMidMerge, autoMax, autoTarget].forEach(function(control) {
                if (control) control.disabled = AUTO_MEMORY_BUSY || routeChanged;
            });
        }

        function flashAutoSettingsSaved() {
            clearTimeout(autoSettingsSaveLabelTimer);
            btnAutoSaveSettings.textContent = '저장됨';
            autoSettingsSaveLabelTimer = setTimeout(function() {
                if (btnAutoSaveSettings && btnAutoSaveSettings.isConnected) btnAutoSaveSettings.textContent = '설정 저장';
            }, 1000);
        }

        function saveAutoSettingsOnlyFromUi(options) {
            options = options || {};
            var uiSettings = readAutoSettingsFromUi();
            if (!uiSettings) return null;
            var previousSettings = getAutoMemorySettings(modalChatId);
            var nextSettings = Object.assign({}, previousSettings);
            autoSettingsDirtyFields.forEach(function(key) {
                nextSettings[key] = uiSettings[key];
            });
            var saved = saveAutoMemorySettings(modalChatId, nextSettings);
            var settingsChanged = reconcileAutoMemoryStateAfterSettingsChange(modalChatId, previousSettings, saved);
            if (settingsChanged) safelyClearAutoMemoryFailureAfterSettingsSave(modalChatId);
            autoSettings = saved;
            autoSettingsDirty = false;
            setAutoMemorySettingsEditPending(modalChatId, false);
            autoSettingsDirtyFields.clear();
            if (options.writeBack) writeAutoSettingsToUi(saved);
            if (options.flash) flashAutoSettingsSaved();
            renderAutoMemoryStatus();
            return saved;
        }

        function scheduleAutoSettingsSave(delay, fields) {
            if (!modalChatId || getChatId() !== modalChatId) {
                renderAutoMemoryStatus();
                return;
            }
            autoSettingsDirty = true;
            setAutoMemorySettingsEditPending(modalChatId, true);
            (Array.isArray(fields) ? fields : [fields]).filter(Boolean).forEach(function(key) {
                autoSettingsDirtyFields.add(String(key));
            });
            clearTimeout(autoSettingsSaveTimer);
            autoSettingsSaveTimer = setTimeout(function() {
                autoSettingsSaveTimer = 0;
                try {
                    var saved = saveAutoSettingsOnlyFromUi({ flash:true });
                    if (!saved) {
                        setAutoMemorySettingsEditPending(modalChatId, true);
                        autoStatus.textContent = '설정 입력 완료 대기 · 자동 실행 잠시 멈춤';
                    }
                } catch (err) {
                    setAutoMemorySettingsEditPending(modalChatId, true);
                    autoStatus.textContent = '설정 자동 저장 실패 · ' + err.message;
                }
            }, delay == null ? AUTO_MEMORY_SETTINGS_AUTOSAVE_MS : delay);
        }

        var autoSettingsFieldMap = new Map([
            [autoInterval, 'intervalTurns'],
            [autoRead, 'readTurns'],
            [autoExclude, 'excludeRecentTurns'],
            [autoContext, 'contextCards'],
            [autoMidMerge, 'midMergeTurns'],
            [autoMax, 'maxCards'],
            [autoTarget, 'compactTarget']
        ]);
        autoSettingsFieldMap.forEach(function(settingKey, input) {
            input.addEventListener('input', function() {
                var fields = [settingKey];
                if (input === autoMax && syncAutoTargetLimit()) fields.push('compactTarget');
                scheduleAutoSettingsSave(null, fields);
            });
            input.addEventListener('change', function() {
                var fields = [settingKey];
                if (input === autoMax && syncAutoTargetLimit()) fields.push('compactTarget');
                scheduleAutoSettingsSave(0, fields);
            });
        });
        autoEnabled.addEventListener('change', function() { scheduleAutoSettingsSave(0, 'enabled'); });
        autoProtect.addEventListener('change', function() { scheduleAutoSettingsSave(0, 'protectUserAdded'); });

        function persistAutoSettingsFromUi() {
            saveVisibleCredentials(activeCredentialProvider);
            localStorage.setItem('crack_ext_api_provider', selProvider.value);
            localStorage.setItem('crack_ext_' + selProvider.value + '_model', selModel.value);
            localStorage.setItem('crack_ext_summary_style', selStyle.value);
            localStorage.setItem(getReasoningStorageKey(selProvider.value, selModel.value), selReasoning.value || 'auto');
            clearTimeout(autoSettingsSaveTimer);
            autoSettingsSaveTimer = 0;
            var saved = saveAutoSettingsOnlyFromUi({ writeBack:true });
            if (!saved) {
                setAutoMemorySettingsEditPending(modalChatId, true);
                throw new Error('자동 설정의 빈칸이나 범위를 확인해주세요. 최대 슬롯은 5~20, 압축 목표는 최대 슬롯 이하여야 합니다.');
            }
            safelyClearAutoMemoryFailureAfterSettingsSave(modalChatId);
            renderAutoMemoryStatus();
            return saved;
        }

        btnAutoSaveSettings.onclick = async function(e) {
            e.preventDefault();
            e.stopPropagation();
            try {
                if (!modalChatId || getChatId() !== modalChatId) throw new Error('설정창을 연 채팅방과 현재 채팅방이 다릅니다. 창을 닫고 현재 방에서 다시 열어주세요.');
                persistAutoSettingsFromUi();
            } catch (err) {
                await showUiAlert(err.message, '자동 설정 저장 실패', { tone:'warning' });
                return;
            }
            showToast('현재 채팅방의 자동 장기기억 설정을 저장했습니다.');
            if (autoEnabled.checked) setTimeout(pollAutoMemory, 100);
        };

        btnAutoRun.onclick = async function(e) {
            e.preventDefault();
            e.stopPropagation();
            try {
                if (!modalChatId || getChatId() !== modalChatId) throw new Error('설정창을 연 채팅방과 현재 채팅방이 다릅니다. 창을 닫고 현재 방에서 다시 열어주세요.');
                persistAutoSettingsFromUi();
            } catch (err) {
                await showUiAlert(err.message, '자동 설정 저장 실패', { tone:'warning' });
                return;
            }
            renderAutoMemoryStatus();
            await runAutoMemory(true);
            renderAutoMemoryStatus();
        };

        btnAutoReset.onclick = async function(e) {
            e.preventDefault();
            e.stopPropagation();
            var resetChatId = modalChatId;
            if (!resetChatId || getChatId() !== resetChatId) {
                await showUiAlert('설정창을 연 채팅방과 현재 채팅방이 다릅니다. 창을 닫고 현재 방에서 다시 열어주세요.', '채팅방 변경 감지', { tone:'warning' });
                return;
            }
            var resetState = getAutoMemoryState(resetChatId);
            if (resetState.pendingApply) {
                if (!(await showUiConfirm('미완료 저장 계획을 폐기하고 같은 대화 구간을 다시 계획할까요?\n이미 성공한 PATCH 내용과 삭제된 슬롯은 되돌리지 않으며, 서버에는 추가 변경을 하지 않습니다.', '미완료 계획 폐기', { confirmText:'폐기 후 재계획', tone:'warning', preventBackdropClose:true }))) return;
                if (!acquireAutoMemoryLock(resetChatId)) {
                    await showUiAlert('다른 탭에서 자동 저장을 처리 중입니다. 잠시 후 다시 시도해주세요.', '자동 저장 처리 중', { tone:'warning' });
                    return;
                }
                try {
                    await discardPendingAutoApply(resetChatId, resetState);
                } catch (err) {
                    await showUiAlert(String(err && err.message || err), '미완료 계획 폐기 실패', { tone:'danger' });
                    return;
                } finally {
                    releaseAutoMemoryLock(resetChatId);
                }
                renderAutoMemoryStatus();
                showToast('미완료 계획을 폐기했습니다. 같은 로그를 다시 정리합니다.');
                if (autoEnabled.checked) setTimeout(pollAutoMemory, 100);
                return;
            }
            if (!(await showUiConfirm('현재 채팅의 자동 요약 기준점, 관리 이력, 자동 AI 비용 기록을 초기화할까요?\n저장된 장기기억 카드는 삭제하지 않습니다.', '자동 요약 기준점 초기화', { confirmText:'초기화', tone:'warning' }))) return;
            resetAutoMemoryState(resetChatId);
            renderAutoMemoryStatus();
            if (autoEnabled.checked) setTimeout(pollAutoMemory, 100);
        };

        var autoStatusHandler = function(event) {
            if (!overlay.isConnected) {
                window.removeEventListener('crack-ext-auto-memory-status', autoStatusHandler);
                return;
            }
            if (getChatId() !== modalChatId || !event.detail || !event.detail.chatId || event.detail.chatId === modalChatId) renderAutoMemoryStatus();
        };
        window.addEventListener('crack-ext-auto-memory-status', autoStatusHandler);
        autoSettingsStorageHandler = function(event) {
            if (!overlay.isConnected) {
                window.removeEventListener('storage', autoSettingsStorageHandler);
                return;
            }
            if (!event || event.key !== getAutoMemorySettingsStorageKey(modalChatId, false) || autoSettingsDirty || isAutoMemorySettingsEditPending(modalChatId)) return;
            autoSettings = getAutoMemorySettings(modalChatId);
            writeAutoSettingsToUi(autoSettings);
            renderAutoMemoryStatus();
        };
        window.addEventListener('storage', autoSettingsStorageHandler);
        renderAutoMemoryStatus();

        selPromptMode.onchange = async function() {
            var previous = promptMode;
            if (!(await confirmDiscardPromptEdit())) {
                selPromptMode.value = previous;
                return;
            }
            promptMode = selPromptMode.value;
            renderPromptSlots();
            if (isPromptMode) {
                var nextModeSlot = getSelectedPromptSlot();
                editingSlotId = nextModeSlot.id;
                txtResult.value = nextModeSlot.prompt;
            }
            updatePreviewCards();
        };

        selPromptSlot.onchange = async function() {
            var newId = selPromptSlot.value;
            if (!(await confirmDiscardPromptEdit())) {
                renderPromptSlots(getActivePromptSlot(promptMode).id);
                return;
            }
            var active = setActivePromptSlot(promptMode, newId);
            if (isPromptMode) {
                editingSlotId = active.id;
                txtResult.value = active.prompt;
            }
            updatePreviewCards();
        };

        btnTogglePrompt.onclick = function(e) {
            e.stopPropagation();
            e.preventDefault();
            tempResultContent = txtResult.value;
            renderPromptSlots();
            var editSlot = getSelectedPromptSlot();
            editingSlotId = editSlot.id;
            txtResult.value = editSlot.prompt;
            setPromptEditUi(true);
        };

        btnPromptBack.onclick = async function(e) {
            e.stopPropagation();
            e.preventDefault();
            if (!(await confirmDiscardPromptEdit())) return;
            txtResult.value = tempResultContent;
            setPromptEditUi(false);
        };

        btnSavePrompt.onclick = async function(e) {
            e.stopPropagation();
            e.preventDefault();
            var promptText = txtResult.value.trim();
            if (!promptText) { await showUiAlert('프롬프트 내용을 입력해주세요.', '내용 없음', { tone:'warning' }); return; }
            var slot = getSelectedPromptSlot();
            updatePromptSlot(promptMode, slot.id, { prompt: promptText });
            setActivePromptSlot(promptMode, slot.id);
            editingSlotId = slot.id;
            showToast('✅ [' + slot.name + '] 슬롯이 저장되었습니다.');
        };

        btnAddPrompt.onclick = async function(e) {
            e.stopPropagation();
            e.preventDefault();
            var dialogResult = await showThemedDialog({
                title: '새 프롬프트 슬롯',
                message: '새 슬롯의 이름을 입력하세요. 현재 편집 중인 프롬프트가 새 슬롯에 복사됩니다.',
                inputValue: '새 프롬프트',
                maxLength: 30,
                confirmText: '추가'
            });
            if (!dialogResult.confirmed) return;
            var slots = loadPromptSlots(promptMode);
            var slot = {
                id: makePromptSlotId(promptMode),
                name: dialogResult.value.slice(0, 30),
                prompt: txtResult.value.trim() || getDefaultPrompt(promptMode)
            };
            slots.push(slot);
            savePromptSlots(promptMode, slots);
            setActivePromptSlot(promptMode, slot.id);
            renderPromptSlots(slot.id);
            editingSlotId = slot.id;
            txtResult.value = slot.prompt;
            showToast('프롬프트 슬롯을 추가했습니다.');
        };

        btnRenamePrompt.onclick = async function(e) {
            e.stopPropagation();
            e.preventDefault();
            var slot = getSelectedPromptSlot();
            var dialogResult = await showThemedDialog({
                title: '슬롯 이름 변경',
                message: '선택한 프롬프트 슬롯의 이름을 변경합니다.',
                inputValue: slot.name,
                maxLength: 30,
                confirmText: '변경'
            });
            if (!dialogResult.confirmed) return;
            updatePromptSlot(promptMode, slot.id, { name: dialogResult.value.slice(0, 30) });
            renderPromptSlots(slot.id);
        };

        btnDeletePrompt.onclick = async function(e) {
            e.stopPropagation();
            e.preventDefault();
            var slots = loadPromptSlots(promptMode);
            if (slots.length <= 1) {
                await showThemedDialog({
                    title: '슬롯을 삭제할 수 없음',
                    message: '최소 1개의 프롬프트 슬롯은 남아 있어야 합니다.',
                    confirmText: '확인',
                    hideCancel: true
                });
                return;
            }
            var slot = getSelectedPromptSlot();
            var dialogResult = await showThemedDialog({
                title: '프롬프트 슬롯 삭제',
                message: '[' + slot.name + '] 슬롯을 삭제할까요?\n삭제한 슬롯은 복구할 수 없습니다.',
                confirmText: '삭제',
                danger: true
            });
            if (!dialogResult.confirmed) return;
            slots = slots.filter(function(item) { return item.id !== slot.id; });
            savePromptSlots(promptMode, slots);
            setActivePromptSlot(promptMode, slots[0].id);
            renderPromptSlots(slots[0].id);
            editingSlotId = slots[0].id;
            txtResult.value = slots[0].prompt;
        };

        btnDefaultPrompt.onclick = async function(e) {
            e.stopPropagation();
            e.preventDefault();
            if (txtResult.value !== getDefaultPrompt(promptMode) && !(await showUiConfirm('현재 편집 내용을 기본 프롬프트로 바꿀까요?\n저장 버튼을 눌러야 슬롯에 반영됩니다.', '기본 프롬프트 불러오기', { confirmText:'불러오기', tone:'warning' }))) return;
            txtResult.value = getDefaultPrompt(promptMode);
        };

        function updateSelectionCount() {
            var selectedText = txtResult.value.substring(txtResult.selectionStart, txtResult.selectionEnd);
            selCounter.textContent = selectedText.length > 0 ? '(드래그: ' + selectedText.length + '자)' : '';
        }
        txtResult.addEventListener('select', updateSelectionCount);
        txtResult.addEventListener('keyup', updateSelectionCount);
        txtResult.addEventListener('mouseup', updateSelectionCount);

        function updatePreviewCards() {
            if (isPromptMode || isGenerating) {
                previewCards.innerHTML = '';
                cardNav.style.display = 'none';
                return;
            }
            var content = txtResult.value.trim();
            if (!content) {
                previewCards.innerHTML = '';
                cardNav.style.display = 'none';
                parsedCards = [];
                return;
            }
            if (content === '요약 중...' || content.startsWith('오류:')) {
                previewCards.innerHTML = '';
                cardNav.style.display = 'none';
                parsedCards = [];
                return;
            }

            parsedCards = parseGeneratedMemoryCards(content);

            if (parsedCards.length === 0) {
                previewCards.innerHTML = '<div class="crack-ext-session-card" style="color:#888!important;">[제목]으로 시작하는 슬롯 구조를 찾지 못했습니다. 결과 형식을 확인해주세요.</div>';
                cardNav.style.display = 'none';
                return;
            }
            if (currentCardIndex >= parsedCards.length) currentCardIndex = parsedCards.length - 1;
            if (currentCardIndex < 0) currentCardIndex = 0;
            cardNav.style.display = parsedCards.length > 1 ? 'flex' : 'none';
            if (parsedCards.length > 1) spanCardPage.textContent = (currentCardIndex + 1) + ' / ' + parsedCards.length;

            var mem = parsedCards[currentCardIndex];
            var tClass = mem.title.length > GENERATED_TITLE_MAX ? 'crack-ext-count-error' : '';
            var sClass = mem.summary.length > GENERATED_SUMMARY_MAX ? 'crack-ext-count-error' : '';
            previewCards.innerHTML = '<div class="crack-ext-session-card">' +
                '<div class="crack-ext-session-title"><div><span style="color:#888;">[ </span>' + escapeHtml(mem.title) + '<span style="color:#888;"> ]</span></div>' +
                '<span class="crack-ext-char-count ' + tClass + '">(' + mem.title.length + '/' + GENERATED_TITLE_MAX + '자)</span></div>' +
                '<div class="crack-ext-session-content">' + escapeHtml(mem.summary) +
                '<div style="text-align:right;margin-top:6px;"><span class="crack-ext-char-count ' + sClass + '">(' + mem.summary.length + '/' + GENERATED_SUMMARY_MAX + '자)</span></div></div></div>';
        }

        // 결과를 직접 편집할 때 매 키 입력마다 전체 슬롯을 재파싱하지 않도록 짧게 debounce한다.
        var previewUpdateTimer = 0;
        function schedulePreviewUpdate() {
            clearTimeout(previewUpdateTimer);
            previewUpdateTimer = setTimeout(function() {
                previewUpdateTimer = 0;
                if (overlay.isConnected) updatePreviewCards();
            }, 100);
        }
        function flushPreviewUpdate() {
            if (previewUpdateTimer) {
                clearTimeout(previewUpdateTimer);
                previewUpdateTimer = 0;
            }
            updatePreviewCards();
        }
        txtResult.addEventListener('input', function() {
            schedulePreviewUpdate();
            if (!isPromptMode && !isGenerating) saveAiResultDraft(txtResult.value, resultMode);
        });
        btnCardPrev.onclick = function(e) { e.preventDefault(); if (currentCardIndex > 0) { currentCardIndex--; flushPreviewUpdate(); } };
        btnCardNext.onclick = function(e) { e.preventDefault(); if (currentCardIndex < parsedCards.length - 1) { currentCardIndex++; flushPreviewUpdate(); } };

        overlay.querySelectorAll('.crack-ext-export-btn').forEach(function(btn) {
            btn.onclick = async function(e) {
                e.preventDefault();
                if (btn.disabled) return;
                var originalText = btn.textContent;
                btn.disabled = true;
                btn.textContent = '...';
                try {
                    var format = btn.dataset.export;
                    var currentContent = txtResult.value.trim();
                    var cards = currentContent ? parseGeneratedMemoryCards(currentContent) : [];
                    var exportSource = '현재 생성 결과';

                    // 현재 결과가 비어 있으면 크랙 API에서 저장된 장기기억 전체를 불러와 내보낸다.
                    if (!cards.length) {
                        var savedSummaries = await fetchSummaries();
                        cards = (savedSummaries || []).filter(function(item) {
                            return item && String(item.title || '').trim() && String(item.summary || '').trim();
                        }).map(function(item) {
                            return { title:String(item.title || '').trim(), summary:String(item.summary || '').trim() };
                        });
                        exportSource = '저장된 장기기억';
                    }

                    if (!cards.length) {
                        await showUiAlert('현재 생성 결과와 저장된 장기기억 모두 비어 있습니다.', '내보낼 내용 없음', { tone:'warning' });
                        return;
                    }
                    var timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
                    var filename;
                    var content;
                    var mimeType;
                    if (format === 'json') {
                        filename = 'summary_' + timestamp + '.json';
                        content = exportAsJson(cards);
                        mimeType = 'application/json';
                    } else if (format === 'md') {
                        filename = 'summary_' + timestamp + '.md';
                        content = exportAsMarkdown(cards);
                        mimeType = 'text/markdown';
                    } else {
                        filename = 'summary_' + timestamp + '.txt';
                        content = exportAsTxt(cards);
                        mimeType = 'text/plain';
                    }
                    downloadFile(content, filename, mimeType);
                    showToast(exportSource + ' ' + cards.length + '개를 ' + format.toUpperCase() + '로 내보냈습니다.');
                } catch (err) {
                    await showUiAlert('내보내기 중 오류: ' + err.message, '내보내기 오류', { tone:'danger' });
                } finally {
                    btn.disabled = false;
                    btn.textContent = originalText;
                }
            };
        });

        async function closeMainModal() {
            clearTimeout(autoSettingsSaveTimer);
            autoSettingsSaveTimer = 0;
            if (autoSettingsDirty) {
                try {
                    var savedAutoSettings = saveAutoSettingsOnlyFromUi({ writeBack:true });
                    if (!savedAutoSettings) {
                        setAutoMemorySettingsEditPending(modalChatId, true);
                        await showUiAlert('자동 설정의 빈칸이나 범위를 확인해주세요. 최대 슬롯은 5~20, 압축 목표는 최대 슬롯 이하여야 합니다.', '자동 설정 확인', { tone:'warning' });
                        return;
                    }
                } catch (err) {
                    setAutoMemorySettingsEditPending(modalChatId, true);
                    await showUiAlert(err.message, '자동 설정 저장 실패', { tone:'warning' });
                    return;
                }
            }
            if (hasUnsavedPromptText() && !(await showUiConfirm('저장하지 않은 프롬프트 수정이 있습니다. 창을 닫을까요?', '저장하지 않은 변경사항', { confirmText:'닫기', danger:true }))) return;
            if (!isGenerating) saveAiResultDraft(isPromptMode ? tempResultContent : txtResult.value, resultMode);
            clearTimeout(autoSettingsSaveLabelTimer);
            if (autoSettingsStorageHandler) window.removeEventListener('storage', autoSettingsStorageHandler);
            releaseVertexSessionSecrets();
            overlay.remove();
        }
        btnXClose.onclick = function(e) { e.stopPropagation(); closeMainModal(); };
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) closeMainModal();
        });

        btnCompress.onclick = async function(e) {
            e.stopPropagation();
            if (selProvider.value === 'vertex') {
                try {
                    if (!getSavedVertexJson()) throw new Error('Vertex JSON을 입력하거나 저장해주세요.');
                } catch (err) {
                    updateVertexCredentialStatus('JSON 확인 필요: ' + err.message, 'error');
                    await showUiAlert(err.message, 'Vertex JSON 오류', { tone:'danger' });
                    return;
                }
            }
            saveVisibleCredentials(activeCredentialProvider);
            localStorage.setItem('crack_ext_api_provider', selProvider.value);
            localStorage.setItem('crack_ext_' + selProvider.value + '_model', selModel.value);
            overlay.style.display = 'none';
            showCompressModal(overlay);
        };
        btnMemoryEdit.onclick = function(e) {
            e.stopPropagation();
            overlay.style.display = 'none';
            showMemoryEditorModal(overlay);
        };

        btnGen.onclick = async function(e) {
            e.stopPropagation();
            var provider = selProvider.value;
            var apiKey = inputKey.value.trim();
            var firebaseScript = inputFirebase.value.trim();
            var vertexJson = getSavedVertexJson();
            var vertexLocation = inputVertexLocation.value.trim() || 'global';
            var vertexProjectId = inputVertexProject.value.trim();
            var model = selModel.value;
            var turnsVal = parseInt(inputTurns.value, 10);
            var turns = isNaN(turnsVal) ? 15 : turnsVal;
            var style = selStyle.value;
            var reasoning = selReasoning.value || 'auto';

            if (provider !== 'firebase' && provider !== 'vertex' && !apiKey) { await showUiAlert('API Key를 입력해주세요.', 'API Key 필요', { tone:'warning' }); return; }
            if (provider === 'firebase' && !firebaseScript) { await showUiAlert('Firebase 스크립트를 입력해주세요.', 'Firebase 설정 필요', { tone:'warning' }); return; }
            if (provider === 'vertex' && !vertexJson) { await showUiAlert('서비스 계정 JSON을 입력하거나 저장해주세요.', 'Vertex JSON 필요', { tone:'warning' }); return; }

            localStorage.setItem('crack_ext_api_provider', provider);
            localStorage.setItem('crack_ext_' + provider + '_model', model);
            localStorage.setItem('crack_ext_turn_count', turns.toString());
            localStorage.setItem('crack_ext_summary_style', style);
            localStorage.setItem(getReasoningStorageKey(provider, model), reasoning);
            saveApiKey(provider, apiKey);
            if (provider === 'firebase') localStorage.setItem('crack_ext_firebase_script', firebaseScript);
            if (provider === 'vertex') {
                saveVertexEndpointSettings(vertexLocation, vertexProjectId);
            }

            saveAiResultDraft(txtResult.value, resultMode);
            isGenerating = true;
            btnGen.disabled = true;
            btnSave.disabled = true;
            txtResult.value = '요약 중...';
            reasoningUsageEl.textContent = '추론 ' + getReasoningOptionLabel(provider, model, reasoning) + ' · 생성 중';
            reasoningUsageEl.classList.add('is-working');
            resultMode = 'main';
            currentCardIndex = 0;
            updatePreviewCards();

            try {
                var chatLog = await fetchRecentMessages(turns);
                if (!chatLog) throw new Error('내역을 불러올 수 없습니다.');
                var config = {
                    apiKey:apiKey,
                    model:model,
                    firebaseScript:firebaseScript,
                    vertexJson:vertexJson,
                    vertexLocation:vertexLocation,
                    vertexProjectId:vertexProjectId,
                    reasoning:reasoning
                };
                var finalResult = await callAI(provider, config, chatLog, turns, style, false);
                updateReasoningUsage(LAST_AI_USAGE, false);
                var finalizedResult = await finalizeGeneratedMemoryResult(provider, config, finalResult, false);
                txtResult.value = finalizedResult.text;
                saveAiResultDraft(txtResult.value, resultMode);
            } catch (err) {
                txtResult.value = '오류: ' + err.message;
                reasoningUsageEl.textContent = '';
                reasoningUsageEl.classList.remove('is-working');
            } finally {
                isGenerating = false;
                btnGen.disabled = false;
                btnSave.disabled = false;
                btnGen.innerHTML = UI_ICONS.sparkle + '<span>재생성 (리롤)</span>';
                updatePreviewCards();
            }
        };

        btnSave.onclick = async function(e) {
            e.stopPropagation();
            flushPreviewUpdate();
            if (!parsedCards.length) { await showUiAlert('추가할 요약이 없습니다.', '추가할 내용 없음', { tone:'warning' }); return; }
            var errorIndex = -1;
            for (var i = 0; i < parsedCards.length; i++) {
                if (!parsedCards[i].title.trim() || !parsedCards[i].summary.trim() || parsedCards[i].title.length > GENERATED_TITLE_MAX || parsedCards[i].summary.length > GENERATED_SUMMARY_MAX) {
                    errorIndex = i;
                    break;
                }
            }
            if (errorIndex >= 0) {
                currentCardIndex = errorIndex;
                updatePreviewCards();
                await showUiAlert('빈 항목이 있거나 저장 한도(제목 ' + GENERATED_TITLE_MAX + '자, 내용 ' + GENERATED_SUMMARY_MAX + '자)를 초과한 항목이 있습니다.', '저장 한도 확인', { tone:'warning' });
                return;
            }
            btnSave.disabled = true;
            btnXClose.disabled = true;
            var successCount = 0;
            var addFailures = [];
            for (var j = 0; j < parsedCards.length; j++) {
                btnSave.innerHTML = UI_ICONS.plus + '<span>추가 중... (' + (j + 1) + '/' + parsedCards.length + ')</span>';
                var res = await apiCall('POST', '/summaries', { type:'shortTerm', title:parsedCards[j].title, summary:parsedCards[j].summary });
                if (res) successCount++;
                else addFailures.push('[' + parsedCards[j].title + '] 추가 실패');
            }
            if (addFailures.length) await showUiAlert(addFailures.join('\n'), '일부 요약 추가 실패', { tone:'danger' });
            if (successCount > 0) {
                clearAiResultDraft();
                showToast(successCount + '개의 요약이 장기 기억에 추가되었습니다.');
                releaseVertexSessionSecrets();
                overlay.remove();
                var dialogEl = document.querySelector('[role="dialog"]');
                if (dialogEl) refreshCurrentTab(dialogEl);
            } else {
                btnSave.innerHTML = UI_ICONS.plus + '<span>추가하기</span>';
                btnSave.disabled = false;
                btnXClose.disabled = false;
            }
        };

        if (prefillText) {
            txtResult.value = prefillText;
            saveAiResultDraft(prefillText, resultMode);
            updatePreviewCards();
        }
    }

    var topHeaderContainerCache = null;
    var topHeaderContainerRoute = '';
    var topHeaderLayoutMode = '';
    var topHeaderAiBtn = null;
    var topHeaderSearchRetryAt = 0;
    var topHeaderRetryTimer = 0;
    var topHeaderRetryDelay = 1200;
    var topHeaderFallbackTimer = 0;
    var topHeaderMissStartedAt = 0;
    var topHeaderMissRoute = '';
    var topHeaderFallbackDelay = 1600;

    function isMobileHeaderLayout() {
        var coarsePointer = false;
        try { coarsePointer = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (e) {}
        return window.innerWidth < 760 || (coarsePointer && Math.min(window.innerWidth || 0, window.innerHeight || 0) < 600);
    }

    function getTopHeaderBandStart() {
        return isMobileHeaderLayout() ? 8 : 40;
    }

    function getTopHeaderBandLimit() {
        return Math.min(150, Math.max(112, window.innerHeight * 0.16));
    }

    function isExcludedHeaderArea(el) {
        if (!el || !el.closest) return true;
        if (el.closest('.crack-ext-ai-overlay,.crack-ext-ui-dialog-overlay')) return true;
        var dialog = el.closest('[role="dialog"],[aria-modal="true"]');
        if (dialog) {
            var dialogRect = dialog.getBoundingClientRect();
            var viewportWidth = Math.max(window.innerWidth || 0, 1);
            var viewportHeight = Math.max(window.innerHeight || 0, 1);
            if (dialogRect.width < viewportWidth * 0.82 || dialogRect.height < viewportHeight * 0.72) return true;
        }
        return !!el.closest('article,pre,code,footer,[data-message-id],[data-message-author-role],[data-role="assistant"],[data-role="user"],[data-testid*="message"],[data-testid*="composer"],[data-testid*="code"],[class*="markdown"],[class*="prose"],[class*="codeblock"],[class*="code-block"],[class*="codeBlock"],[class*="code-header"],[class*="copy-code"],[class*="message-content"],[class*="chat-message"],[class*="composer"],[class*="chat-input"],[class*="message-input"]');
    }

    function isHeaderMeaningAnchor(el) {
        if (!el || !el.isConnected || isExcludedHeaderArea(el)) return false;
        if (el.matches && el.matches('#lore-inj-entry-button,[data-lore-inj-entry="true"],[role="combobox"],button[aria-haspopup="listbox"],button[aria-label*="모델"],button[title*="모델"],button[aria-label*="더보기"],button[title*="더보기"],[data-testid*="chat-header"] button,[class*="chat-header"] button')) return true;
        var text = String(el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title')) || '').toLowerCase();
        return /model|more|option|메뉴|모델|더보기|옵션/.test(text);
    }

    function isRetainableTopHeaderContainer(el) {
        if (!el || !el.isConnected || isExcludedHeaderArea(el)) return false;
        return !el.querySelector('textarea,[contenteditable="true"]');
    }

    function isUsableTopHeaderContainer(el) {
        if (!el || !el.isConnected || isExcludedHeaderArea(el)) return false;
        if (el.querySelector('textarea,[contenteditable="true"]')) return false;

        var rect = el.getBoundingClientRect();
        var viewportWidth = Math.max(window.innerWidth || 0, 1);
        if (rect.width < 48 || rect.height < 16 || rect.height > 80) return false;
        if (rect.top < getTopHeaderBandStart() || rect.top > getTopHeaderBandLimit()) return false;
        if (viewportWidth >= 760 && (rect.width > Math.min(680, viewportWidth * 0.65) || rect.right < viewportWidth * 0.5)) return false;

        var style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
    }

    function isVisibleTopHeaderControl(el) {
        if (!el || !el.isConnected || isExcludedHeaderArea(el)) return false;
        if (el.classList && el.classList.contains('crack-ext-header-ai-btn')) return false;
        var rect = el.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8 || rect.bottom < 0) return false;
        if (rect.top < getTopHeaderBandStart() - 8 || rect.top > getTopHeaderBandLimit() || rect.bottom > getTopHeaderBandLimit() + 28) return false;
        var style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
    }

    function countVisibleTopHeaderControls(el) {
        var controls = el.querySelectorAll('button,[role="button"],[role="combobox"]');
        var count = 0;
        for (var i = 0; i < controls.length; i++) {
            if (isVisibleTopHeaderControl(controls[i])) count++;
        }
        return count;
    }

    function scoreTopHeaderCandidate(el) {
        if (!isUsableTopHeaderContainer(el)) return -Infinity;
        var rect = el.getBoundingClientRect();
        var controls = countVisibleTopHeaderControls(el);
        if (!controls) return -Infinity;
        var viewportWidth = Math.max(window.innerWidth || 0, 1);
        var score = Math.min(controls, 6) * 22 - Math.abs(rect.top - 76) * 1.4 - Math.max(0, rect.width - 360) * 0.22;
        score += Math.max(0, Math.min(36, (rect.left / viewportWidth) * 36));
        if (rect.right >= viewportWidth * 0.72) score += 48;
        var modelLike = el.querySelector('[role="combobox"],button[aria-haspopup="listbox"],button[aria-label*="모델"],button[title*="모델"]');
        if (modelLike && isVisibleTopHeaderControl(modelLike)) score += 90;
        var loreEntry = el.querySelector('#lore-inj-entry-button,[data-lore-inj-entry="true"]');
        if (loreEntry && isVisibleTopHeaderControl(loreEntry)) score += 180;
        return score;
    }

    function findKnownTopActionGroup() {
        var anchors = Array.prototype.slice.call(document.querySelectorAll(
            '#lore-inj-entry-button,[data-lore-inj-entry="true"],[role="combobox"],button[aria-haspopup="listbox"],button[aria-label*="모델"],button[title*="모델"],button[aria-label*="더보기"],button[title*="더보기"],[data-testid*="chat-header"] button,[class*="chat-header"] button'
        ));
        var best = null;
        var bestScore = -Infinity;
        for (var i = 0; i < anchors.length; i++) {
            if (!isVisibleTopHeaderControl(anchors[i])) continue;
            var parent = anchors[i].parentElement;
            var depth = 0;
            while (parent && parent !== document.body && depth < 8) {
                if (isUsableTopHeaderContainer(parent)) {
                    var display = window.getComputedStyle(parent).display;
                    var controls = countVisibleTopHeaderControls(parent);
                    if ((display === 'flex' || display === 'inline-flex' || display === 'grid' || display === 'block') && controls >= 1 && controls <= 12) {
                        var score = scoreTopHeaderCandidate(parent);
                        if (score > bestScore) {
                            best = parent;
                            bestScore = score;
                        }
                    }
                }
                parent = parent.parentElement;
                depth++;
            }
        }
        return best;
    }

    function findBestSelectorCandidate(selector) {
        var found = [];
        try { found = document.querySelectorAll(selector); } catch (e) { return null; }
        var best = null;
        var bestScore = -Infinity;
        for (var i = 0; i < found.length; i++) {
            if (isMobileHeaderLayout()) {
                var rect = found[i].getBoundingClientRect();
                var viewportWidth = Math.max(window.innerWidth || 0, 1);
                if (rect.top < 36 || rect.right < viewportWidth * 0.55) continue;
            }
            var score = scoreTopHeaderCandidate(found[i]);
            if (score > bestScore) {
                best = found[i];
                bestScore = score;
            }
        }
        return best;
    }

    function findLegacyTopActionGroup() {
        if (!getChatId()) return null;
        var isStory = /\/stories\/[a-f0-9-]+\/episodes\/[a-f0-9-]+/i.test(location.pathname) || /\/u\/[a-f0-9-]+\/c\/[a-f0-9-]+/i.test(location.pathname);
        var classNames = isStory ? ['css-1c5w7et'] : ['css-l8r172'];
        var best = null;
        var bestScore = -Infinity;
        classNames.forEach(function(className) {
            var panels = document.getElementsByClassName(className);
            for (var i = 0; i < panels.length; i++) {
                var candidates = [panels[i]].concat(Array.prototype.slice.call(panels[i].querySelectorAll('div')));
                for (var j = 0; j < candidates.length; j++) {
                    var score = scoreTopHeaderCandidate(candidates[j]);
                    if (score > bestScore) {
                        best = candidates[j];
                        bestScore = score;
                    }
                }
            }
        });
        return best;
    }

    function isVisibleCompatibleHeaderControl(el) {
        if (!el || !el.isConnected || isExcludedHeaderArea(el)) return false;
        if (el.classList && el.classList.contains('crack-ext-header-ai-btn')) return false;
        var rect = el.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8 || rect.bottom <= 0 || rect.top > Math.min(220, window.innerHeight * 0.3)) return false;
        var style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
    }

    function countVisibleCompatibleHeaderControls(el) {
        var controls = el.querySelectorAll('button,[role="button"],[role="combobox"]');
        var count = 0;
        for (var i = 0; i < controls.length; i++) {
            if (isVisibleCompatibleHeaderControl(controls[i])) count++;
        }
        return count;
    }

    function findPositionedTopHeaderShell(el) {
        var node = el;
        var depth = 0;
        var limit = Math.min(220, Math.max(150, window.innerHeight * 0.28));
        while (node && node !== document.body && depth < 8) {
            if (isExcludedHeaderArea(node)) return null;
            var rect = node.getBoundingClientRect();
            var style = window.getComputedStyle(node);
            if ((style.position === 'fixed' || style.position === 'sticky' || style.position === 'absolute') &&
                rect.bottom > 0 && rect.top <= limit && rect.height > 16 && rect.height <= 220) return node;
            node = node.parentElement;
            depth++;
        }
        return null;
    }

    function getNonInteractiveHeaderText(el) {
        if (!el || !document.createTreeWalker) return '';
        var walker = document.createTreeWalker(el, 4);
        var parts = [];
        var node;
        while ((node = walker.nextNode()) && parts.join(' ').length < 120) {
            var parent = node.parentElement;
            if (!parent || parent.closest('button,[role="button"],[role="combobox"],script,style')) continue;
            var text = String(node.nodeValue || '').replace(/\s+/g, ' ').trim();
            if (text) parts.push(text);
        }
        return parts.join(' ').replace(/\s+/g, ' ').trim();
    }

    function hasCompatibleHeaderMeaning(el, shell) {
        var scope = el || shell;
        if (!scope) return false;
        if (scope.querySelector('[data-testid*="title"],[class*="title"],[role="heading"],h1,h2,button[aria-label*="뒤로"],button[title*="뒤로"],button[aria-label*="back" i],button[title*="back" i]')) return true;
        var text = getNonInteractiveHeaderText(scope);
        if (!text && shell && shell !== scope) text = getNonInteractiveHeaderText(shell);
        if (!text || text.length > 100) return false;
        return !/^(크랙|wrtn|설정|검색|메뉴|홈)$/i.test(text.replace(/[\s·|/]+/g, ''));
    }

    function findCompatibleMobileTopActionGroup() {
        if (!getChatId()) return null;
        var controls = document.querySelectorAll('button,[role="button"],[role="combobox"]');
        var seen = new Set();
        var best = null;
        var bestScore = -Infinity;
        var viewportWidth = Math.max(window.innerWidth || 0, 1);
        var limit = Math.min(220, Math.max(150, window.innerHeight * 0.28));

        for (var i = 0; i < controls.length; i++) {
            if (!isVisibleCompatibleHeaderControl(controls[i])) continue;
            var parent = controls[i].parentElement;
            var depth = 0;
            while (parent && parent !== document.body && depth < 7) {
                if (!seen.has(parent) && !isExcludedHeaderArea(parent) && !parent.querySelector('textarea,[contenteditable="true"]')) {
                    seen.add(parent);
                    var rect = parent.getBoundingClientRect();
                    var style = window.getComputedStyle(parent);
                    var displayOk = style.display === 'flex' || style.display === 'inline-flex' || style.display === 'grid';
                    var controlCount = countVisibleCompatibleHeaderControls(parent);
                    var shell = findPositionedTopHeaderShell(parent);
                    var meaning = hasCompatibleHeaderMeaning(parent, shell);
                    var topOk = rect.top >= 0 && rect.top <= limit;
                    var sizeOk = rect.width >= 48 && rect.height >= 16 && rect.height <= 104;
                    var horizontalOk = rect.right >= viewportWidth * 0.45 && rect.left < viewportWidth + 8;
                    if (displayOk && shell && meaning && topOk && sizeOk && horizontalOk && controlCount >= 2 && controlCount <= 14) {
                        var score = Math.min(controlCount, 6) * 18 - Math.abs(rect.top - 72) * 0.9 - Math.max(0, rect.width - 420) * 0.14;
                        score += Math.max(0, Math.min(44, (rect.left / viewportWidth) * 44));
                        if (rect.right >= viewportWidth * 0.72) score += 52;
                        if (meaning) score += 72;
                        if (parent.closest('header,[data-testid*="header"],[class*="header"]')) score += 56;
                        if (score > bestScore) {
                            best = parent;
                            bestScore = score;
                        }
                    }
                }
                parent = parent.parentElement;
                depth++;
            }
        }
        return best;
    }

    function findGeometricTopActionGroup() {
        // 제목·모델 선택 줄과 같은 세로 대역만 검사한다. 페이지 전역 최상단 바는 제외한다.
        // 화면 폭과 무관하게 제한된 기하 탐색을 쓰며, 모바일도 입력창 FAB로 내리지 않는다.
        if (!getChatId()) return null;

        var controls = document.querySelectorAll('button,[role="button"]');
        var candidates = [];
        var seen = new Set();
        var viewportWidth = Math.max(window.innerWidth || 0, 1);
        var mobileLayout = isMobileHeaderLayout();
        var minLeft = mobileLayout ? 0 : Math.max(260, Math.floor(viewportWidth * 0.28));
        for (var i = 0; i < controls.length; i++) {
            if (!isVisibleTopHeaderControl(controls[i])) continue;
            var controlRect = controls[i].getBoundingClientRect();
            if (mobileLayout && controlRect.top < 36) continue;
            if (controlRect.left < minLeft || controlRect.right > viewportWidth + 8) continue;
            var parent = controls[i].parentElement;
            var depth = 0;
            while (parent && parent !== document.body && depth < 6) {
                if (!seen.has(parent) && isUsableTopHeaderContainer(parent)) {
                    var display = window.getComputedStyle(parent).display;
                    var controlCount = countVisibleTopHeaderControls(parent);
                    var modelLike = parent.querySelector('[role="combobox"],button[aria-haspopup="listbox"],button[aria-label*="모델"],button[title*="모델"]');
                    var parentRect = parent.getBoundingClientRect();
                    var mobileScopeOk = !mobileLayout || (!!parent.closest('main') && parentRect.top >= 36 && parentRect.right >= viewportWidth * 0.55);
                    if (mobileScopeOk && (display === 'flex' || display === 'inline-flex' || display === 'grid') && controlCount >= 1 && controlCount <= (mobileLayout ? 8 : 10)) {
                        seen.add(parent);
                        candidates.push(parent);
                    }
                }
                parent = parent.parentElement;
                depth++;
            }
        }

        var best = null;
        var bestScore = -Infinity;
        for (var j = 0; j < candidates.length; j++) {
            var score = scoreTopHeaderCandidate(candidates[j]);
            if (score > bestScore) {
                best = candidates[j];
                bestScore = score;
            }
        }
        return best;
    }

    function findTopHeaderContainer() {
        var currentRoute = getChatId() || location.pathname || 'current';
        var currentLayoutMode = isMobileHeaderLayout() ? 'mobile' : 'desktop';
        if (topHeaderLayoutMode && topHeaderLayoutMode !== currentLayoutMode && topHeaderContainerCache) {
            var cachedStyle = window.getComputedStyle(topHeaderContainerCache);
            if (cachedStyle.display === 'none' || !topHeaderContainerCache.getClientRects().length) topHeaderContainerCache = null;
        }
        topHeaderLayoutMode = currentLayoutMode;
        var retainedHiddenContainer = null;
        if (topHeaderContainerRoute === currentRoute && isRetainableTopHeaderContainer(topHeaderContainerCache)) {
            if (isUsableTopHeaderContainer(topHeaderContainerCache)) {
                var knownReplacement = findKnownTopActionGroup();
                if (knownReplacement && knownReplacement !== topHeaderContainerCache) {
                    topHeaderContainerCache = knownReplacement;
                    return knownReplacement;
                }
                return topHeaderContainerCache;
            }
            retainedHiddenContainer = topHeaderContainerCache;
        } else {
            topHeaderContainerCache = null;
        }
        topHeaderContainerRoute = currentRoute;
        // 같은 제목창이 접혀 화면 밖으로 나간 동안에는 다른 상단 툴바로 옮기지 않는다.
        if (retainedHiddenContainer) {
            var visibleKnownReplacement = findKnownTopActionGroup();
            if (visibleKnownReplacement && visibleKnownReplacement !== retainedHiddenContainer) {
                topHeaderContainerCache = visibleKnownReplacement;
                return visibleKnownReplacement;
            }
            var retainedStyle = window.getComputedStyle(retainedHiddenContainer);
            if (retainedStyle.display === 'none' || !retainedHiddenContainer.getClientRects().length) {
                topHeaderContainerCache = null;
            } else {
                topHeaderContainerCache = retainedHiddenContainer;
                return retainedHiddenContainer;
            }
        }

        var legacy = findLegacyTopActionGroup();
        if (legacy) {
            topHeaderContainerCache = legacy;
            return legacy;
        }

        var known = findKnownTopActionGroup();
        if (known) {
            topHeaderContainerCache = known;
            return known;
        }

        // 구체적인 제목창 액션 영역만 찾고, 실패하면 제한된 기하 탐색을 사용한다.
        var selectors = [
            '.absolute.z-\\[5\\] .flex.gap-3.items-center',
            '.absolute.z-\\[5\\] [class*="items-center"]',
            '[data-testid*="chat-header"] [class*="items-center"]',
            '[class*="chat-header"] [class*="items-center"]'
        ];
        selectors = selectors.concat([
            'main header [class*="items-center"]',
            'main [class*="sticky"] [class*="items-center"]',
            'main [class*="absolute"] [class*="items-center"]',
            'main [role="toolbar"]'
        ]);

        for (var i = 0; i < selectors.length; i++) {
            var candidate = findBestSelectorCandidate(selectors[i]);
            if (candidate) {
                topHeaderContainerCache = candidate;
                return candidate;
            }
        }

        var compatibleMobile = findCompatibleMobileTopActionGroup();
        if (compatibleMobile) {
            topHeaderContainerCache = compatibleMobile;
            return compatibleMobile;
        }

        var geometric = findGeometricTopActionGroup();
        if (geometric) {
            topHeaderContainerCache = geometric;
            return geometric;
        }
        return null;
    }

    function getDirectHeaderChild(host, descendant) {
        if (!host || !descendant || !host.contains(descendant)) return null;
        var node = descendant;
        while (node && node.parentElement !== host) node = node.parentElement;
        return node && node.parentElement === host ? node : null;
    }

    function findTopHeaderInsertBefore(host) {
        if (!host) return null;
        var preferred = host.querySelector('#lore-inj-entry-button,[data-lore-inj-entry="true"]');
        if (!preferred) preferred = host.querySelector('[role="combobox"],button[aria-haspopup="listbox"],button[aria-label*="모델"],button[title*="모델"]');
        var directPreferred = getDirectHeaderChild(host, preferred);
        if (directPreferred) return directPreferred;
        var controls = Array.prototype.slice.call(host.querySelectorAll('button,[role="button"],[role="combobox"]')).filter(isVisibleTopHeaderControl);
        controls.sort(function(a, b) { return a.getBoundingClientRect().left - b.getBoundingClientRect().left; });
        return controls.length ? getDirectHeaderChild(host, controls[0]) : null;
    }

    function createTopHeaderBtn() {
        var aiBtn = document.createElement('button');
        aiBtn.className = 'crack-ext-header-ai-btn';
        aiBtn.type = 'button';
        aiBtn.innerHTML = '<svg class="crack-ext-header-ai-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5h10a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4.5"/></svg><span>요약</span>';
        aiBtn.title = '요약 및 장기기억 도구';
        aiBtn.setAttribute('aria-label', '요약 및 장기기억 도구');
        aiBtn.setAttribute('aria-haspopup', 'dialog');
        aiBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            showMainModal();
        });
        return aiBtn;
    }

    function getOrCreateTopHeaderBtn(headerContainer) {
        var buttons = Array.prototype.slice.call(document.querySelectorAll('.crack-ext-header-ai-btn'));
        var aiBtn = topHeaderAiBtn;

        if (!aiBtn && headerContainer) {
            for (var i = 0; i < buttons.length; i++) {
                if (buttons[i].parentElement === headerContainer) { aiBtn = buttons[i]; break; }
            }
        }
        if (!aiBtn && buttons.length) aiBtn = buttons[0];
        if (!aiBtn) aiBtn = createTopHeaderBtn();
        topHeaderAiBtn = aiBtn;

        for (var k = 0; k < buttons.length; k++) {
            if (buttons[k] !== aiBtn) buttons[k].remove();
        }
        return aiBtn;
    }

    function clearTopHeaderRetry() {
        if (topHeaderRetryTimer) clearTimeout(topHeaderRetryTimer);
        if (topHeaderFallbackTimer) clearTimeout(topHeaderFallbackTimer);
        topHeaderRetryTimer = 0;
        topHeaderFallbackTimer = 0;
        topHeaderSearchRetryAt = 0;
        topHeaderRetryDelay = 1200;
        topHeaderMissStartedAt = 0;
        topHeaderMissRoute = '';
    }

    function scheduleTopHeaderRetry() {
        var chatId = getChatId();
        if (!chatId) return;
        var now = Date.now();
        if (topHeaderMissRoute !== chatId) {
            if (topHeaderRetryTimer) clearTimeout(topHeaderRetryTimer);
            if (topHeaderFallbackTimer) clearTimeout(topHeaderFallbackTimer);
            topHeaderRetryTimer = 0;
            topHeaderFallbackTimer = 0;
            topHeaderRetryDelay = 1200;
            topHeaderMissRoute = chatId;
            topHeaderMissStartedAt = now;
        } else if (!topHeaderMissStartedAt) {
            topHeaderMissStartedAt = now;
        }

        if (!topHeaderRetryTimer) {
            var delay = topHeaderRetryDelay;
            topHeaderSearchRetryAt = now + delay;
            topHeaderRetryTimer = setTimeout(function() {
                topHeaderRetryTimer = 0;
                if (getChatId() !== chatId) return;
                injectTopHeaderBtn(false);
            }, delay);
            topHeaderRetryDelay = Math.min(5000, Math.round(delay * 1.8));
        }

        var fallbackElapsed = now - topHeaderMissStartedAt;
        var fallbackVisible = !!(topHeaderAiBtn && topHeaderAiBtn.isConnected && topHeaderAiBtn.classList.contains('crack-ext-header-fallback'));
        if (!topHeaderFallbackTimer && !fallbackVisible && fallbackElapsed < topHeaderFallbackDelay) {
            var fallbackDelay = topHeaderFallbackDelay - fallbackElapsed;
            topHeaderFallbackTimer = setTimeout(function() {
                topHeaderFallbackTimer = 0;
                if (getChatId() !== chatId) return;
                injectTopHeaderBtn(true);
            }, fallbackDelay);
        }
    }

    function mutationContainsKnownHeaderAnchor(mutation) {
        var selector = '#lore-inj-entry-button,[data-lore-inj-entry="true"],[role="combobox"],button[aria-haspopup="listbox"],button[aria-label*="모델"],button[title*="모델"],button[aria-label*="더보기"],button[title*="더보기"],[data-testid*="chat-header"],[class*="chat-header"]';
        var nodes = mutation && mutation.addedNodes ? Array.prototype.slice.call(mutation.addedNodes) : [];
        if (mutation && mutation.type === 'attributes') nodes.push(mutation.target);
        for (var i = 0; i < nodes.length; i++) {
            var element = nodes[i] && nodes[i].nodeType === 1 ? nodes[i] : null;
            if (!element) continue;
            var matched = (element.matches && element.matches(selector)) || (element.querySelector && element.querySelector(selector));
            if (matched && !isExcludedHeaderArea(element)) return true;
        }
        return false;
    }

    function injectTopHeaderBtn(forceFallback) {
        var chatId = getChatId();
        if (!chatId) {
            clearTopHeaderRetry();
            topHeaderContainerCache = null;
            topHeaderContainerRoute = location.pathname || 'current';
            topHeaderLayoutMode = isMobileHeaderLayout() ? 'mobile' : 'desktop';
            if (topHeaderAiBtn && topHeaderAiBtn.isConnected) topHeaderAiBtn.remove();
            return;
        }
        var headerContainer = findTopHeaderContainer();
        var aiBtn = getOrCreateTopHeaderBtn(headerContainer);

        if (headerContainer) {
            clearTopHeaderRetry();
            aiBtn.classList.remove('crack-ext-floating', 'crack-ext-header-fallback');
            aiBtn.dataset.placement = 'header';
            var before = findTopHeaderInsertBefore(headerContainer);
            if (aiBtn.parentElement !== headerContainer || (before && aiBtn.nextSibling !== before)) {
                if (before) headerContainer.insertBefore(aiBtn, before);
                else headerContainer.appendChild(aiBtn);
            }
            return;
        }
        scheduleTopHeaderRetry();
        var fallbackDue = !!forceFallback || (!!topHeaderMissStartedAt && Date.now() - topHeaderMissStartedAt >= topHeaderFallbackDelay);
        aiBtn.classList.remove('crack-ext-floating');
        if (fallbackDue && document.body) {
            aiBtn.classList.add('crack-ext-header-fallback');
            aiBtn.dataset.placement = 'emergency';
            if (aiBtn.parentElement !== document.body) document.body.appendChild(aiBtn);
        } else {
            aiBtn.classList.remove('crack-ext-header-fallback');
            aiBtn.dataset.placement = 'pending';
            if (aiBtn.isConnected) aiBtn.remove();
        }
    }

    function inject() { injectAiStyles(); injectTopHeaderBtn(); }

    function start() {
        refreshUsdKrwRate(false);
        var injectScheduled = false;

        function needsInjection() {
            if (!document.getElementById('crack-ext-ai-css')) return true;

            var buttons = document.querySelectorAll('.crack-ext-header-ai-btn');
            if (!getChatId()) return buttons.length > 0;
            if (buttons.length > 1) return true;
            if (!buttons.length) return !topHeaderRetryTimer && Date.now() >= topHeaderSearchRetryAt;

            var aiBtn = buttons[0];
            var headerContainer = findTopHeaderContainer();
            if (headerContainer) {
                return aiBtn.parentElement !== headerContainer || aiBtn.classList.contains('crack-ext-floating') || aiBtn.classList.contains('crack-ext-header-fallback');
            }
            return !(aiBtn.isConnected && aiBtn.parentElement === document.body && aiBtn.classList.contains('crack-ext-header-fallback'));
        }

        function scheduleInject(force) {
            if (injectScheduled) return;
            if (!force && !needsInjection()) return;
            injectScheduled = true;
            requestAnimationFrame(function() {
                injectScheduled = false;
                if (force || needsInjection()) inject();
            });
        }

        // 제목창은 접혀 화면 밖으로 나가도 같은 DOM 부모에 고정한다. 방 변경/DOM 교체 때만 다시 찾는다.
        // 같은 Observer에서 AI 답변 본문의 변화가 잠잠해진 시점도 감지해 자동 정리를 깨운다.
        var obs = new MutationObserver(function(mutations) {
            var currentRoute = getChatId() || location.pathname || 'current';
            var routeChanged = !!topHeaderContainerRoute && topHeaderContainerRoute !== currentRoute;
            if (routeChanged) {
                cancelAutoMemorySchedule();
                AUTO_MEMORY_LAST_WAKE_AT = 0;
                clearTopHeaderRetry();
                topHeaderContainerCache = null;
                topHeaderContainerRoute = currentRoute;
                topHeaderLayoutMode = isMobileHeaderLayout() ? 'mobile' : 'desktop';
                topHeaderSearchRetryAt = 0;
                if (topHeaderAiBtn && topHeaderAiBtn.isConnected) topHeaderAiBtn.remove();
            }
            var buttonCount = document.querySelectorAll('.crack-ext-header-ai-btn').length;
            var retryDue = !topHeaderRetryTimer && Date.now() >= topHeaderSearchRetryAt;
            var duplicateButtons = buttonCount > 1;
            var missingButtonDue = buttonCount === 0 && retryDue;
            var knownAnchorAdded = false;
            for (var anchorIndex = 0; anchorIndex < mutations.length; anchorIndex++) {
                if (mutationContainsKnownHeaderAnchor(mutations[anchorIndex])) { knownAnchorAdded = true; break; }
            }
            var shouldRescan = routeChanged || duplicateButtons || missingButtonDue || knownAnchorAdded || (retryDue && (!topHeaderAiBtn || !topHeaderAiBtn.isConnected ||
                !isRetainableTopHeaderContainer(topHeaderContainerCache)));
            if (shouldRescan) scheduleInject();
            for (var i = 0; i < mutations.length; i++) {
                if (mutationTouchesAutoMemoryResponse(mutations[i])) {
                    scheduleAutoMemoryResponseCheck(AUTO_MEMORY_RESPONSE_DEBOUNCE_MS);
                    break;
                }
            }
            if (routeChanged) {
                notifyAutoMemoryStatus(getChatId());
                scheduleAutoMemoryResponseCheck(500);
            }
        });
        obs.observe(document.body, { childList:true, characterData:true, attributes:true, attributeFilter:['class', 'style', 'aria-hidden'], subtree:true });

        scheduleInject(true);
        window.addEventListener('resize', function() {
            scheduleInject();
        }, { passive:true });
        // DOM 클래스 전환을 놓쳐도 캐시는 버리지 않고 같은 제목창을 유지한다.
        setInterval(function() {
            scheduleInject();
        }, 5000);
        scheduleAutoMemoryResponseCheck(1500);
        window.addEventListener('focus', wakeAutoMemoryOnReturn, { passive:true });
        window.addEventListener('pageshow', wakeAutoMemoryOnReturn, { passive:true });
        window.addEventListener('storage', function(event) {
            var chatId = getChatId();
            if (!chatId || !event || event.key !== getAutoMemorySettingsStorageKey(chatId, false)) return;
            notifyAutoMemoryStatus(chatId);
            refreshAutoMemorySchedule(true);
            if (getAutoMemorySettings(chatId).enabled) scheduleAutoMemoryResponseCheck(100);
        });
        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'visible') wakeAutoMemoryOnReturn();
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
