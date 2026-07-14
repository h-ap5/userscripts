// ==UserScript==
// @name         📝 크랙 요약 메모리 편집 & AI 자동 요약 추가
// @namespace    https://crack.wrtn.ai/
// @version      2.2.2
// @description  크랙 내부 장기기억 요약·일괄편집·다중 AI API·프롬프트 슬롯·추론/토큰/예상비용·내보내기·테마형 알림·API키 자동저장
// @author       User
// @match        https://crack.wrtn.ai/*
// @grant        none
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
        compress: 'crack_ext_prompt_slots_compress_v2'
    };
    const PROMPT_ACTIVE_KEYS = {
        main: 'crack_ext_active_prompt_main_v2',
        compress: 'crack_ext_active_prompt_compress_v2'
    };
    const LEGACY_PROMPT_KEYS = {
        main: 'crack_ext_custom_prompt',
        compress: 'crack_ext_compress_prompt'
    };

    function getDefaultPrompt(mode) {
        return mode === 'compress' ? COMPRESS_PROMPT : DEFAULT_PROMPT;
    }

    function migrateBuiltInDefaultPrompt(mode, slots) {
        var defaultId = mode + '-default';
        var slot = slots.find(function(item) { return item && item.id === defaultId; });
        if (!slot || slot.name !== '기본 프롬프트') return false;
        var prompt = slot.prompt || '';
        var isLegacyMain = mode === 'main' && prompt.includes('분리 필수 조건') && prompt.includes('장소 이동') && prompt.includes('병합 금지');
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
        var legacy = localStorage.getItem(LEGACY_PROMPT_KEYS[mode]);
        if (legacy && legacy.trim() && legacy.trim() !== defaultPrompt.trim()) {
            var legacySlot = {
                id: makePromptSlotId(mode),
                name: '기존 사용자 프롬프트',
                prompt: legacy
            };
            slots.push(legacySlot);
            localStorage.setItem(PROMPT_ACTIVE_KEYS[mode], legacySlot.id);
        } else {
            localStorage.setItem(PROMPT_ACTIVE_KEYS[mode], defaultSlot.id);
        }
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

    function getDefaultModel(provider) {
        if (provider === 'google') return 'gemini-3.1-pro-preview';
        if (provider === 'deepseek') return 'deepseek-v4-flash';
        if (provider === 'firebase') return 'gemini-3.1-pro-preview';
        if (provider === 'openai') return 'gpt-5.6-luna';
        return '';
    }

    // ============== 유틸 함수 ==============
    function getChatId() {
        const m = location.pathname.match(/\/episodes\/([a-f0-9]+)/);
        return m ? m[1] : null;
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

    function apiCall(method, path, body) {
        const token = getToken(), chatId = getChatId();
        if (!token || !chatId) {
            showUiAlert('인증 정보 또는 채팅 ID를 찾을 수 없습니다.', '연결 정보 없음', { tone:'warning' });
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
                if (!r.ok) return r.text().then(t => { console.error('API Error:', r.status, t); return null; });
                return r.text().then(t => t ? JSON.parse(t) : { result: 'SUCCESS' });
            })
            .catch(e => { showUiAlert('네트워크 오류: ' + e.message, '네트워크 오류', { tone:'danger' }); return null; });
    }

    async function fetchSummaries() {
    let allSummaries = [];
    let cursor = null;
    while (true) {
        let path = '/summaries?limit=20&type=longTerm';
        if (cursor) path += '&cursor=' + encodeURIComponent(cursor);
        let res = await apiCall('GET', path);
        if (!res || !res.data || !res.data.summaries || res.data.summaries.length === 0) break;
        allSummaries = allSummaries.concat(res.data.summaries);
        if (res.data.nextCursor) {
            cursor = res.data.nextCursor;
        } else {
            break;
        }
    }
    return allSummaries;
}

async function fetchRecentMessages(limit) {
    let allMessages = [];
    let cursor = null;
    let requestedLimit = parseInt(limit, 10);
    if (isNaN(requestedLimit)) requestedLimit = 15;
    const isUnlimited = requestedLimit === 0;
    while (true) {
        let fetchLimit = isUnlimited ? 50 : Math.min(requestedLimit - allMessages.length, 50);
        let path = '/messages?limit=' + fetchLimit;
        if (cursor) path += '&cursor=' + encodeURIComponent(cursor);
        let res = await apiCall('GET', path);
        if (!res || !res.data || !res.data.messages || res.data.messages.length === 0) break;
        allMessages = allMessages.concat(res.data.messages);
        if (!isUnlimited && allMessages.length >= requestedLimit) break;
        if (res.data.nextCursor) {
            cursor = res.data.nextCursor;
        } else {
            break;
        }
    }
    if (!isUnlimited) allMessages = allMessages.slice(0, requestedLimit);
    if (allMessages.length === 0) return null;
    let msgs = allMessages.reverse();
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

    var LAST_AI_USAGE = null;
    var MODEL_PRICING_UPDATED_AT = '2026-07-12';
    var USD_KRW_FALLBACK = 1400;
    var USD_KRW_CACHE_KEY = 'crack_ext_usd_krw_rate_v1';
    var USD_KRW_CACHE_TTL = 12 * 60 * 60 * 1000;

    // 유료 API 표준 처리 기준, USD / 1M tokens. 실제 청구액은 무료 티어·캐시·지역·세금에 따라 달라질 수 있음.
    var MODEL_PRICING_USD_PER_M = {
        google: {
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
        if (provider === 'google' || provider === 'firebase') {
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
        var catalogProvider = provider === 'firebase' ? 'google' : provider;
        var catalog = MODEL_PRICING_USD_PER_M[catalogProvider] || {};
        var price = catalog[String(model || '').toLowerCase()] || null;
        if (!price) return null;
        var useLong = price.threshold && Number(inputTokens || 0) > price.threshold;
        return {
            input:useLong && price.longInput != null ? price.longInput : price.input,
            cachedInput:useLong && price.longCachedInput != null ? price.longCachedInput : price.cachedInput,
            output:useLong && price.longOutput != null ? price.longOutput : price.output,
            estimated:!!price.estimated,
            longContext:!!useLong
        };
    }

    function calculateUsageCost(meta) {
        if (!meta) return null;
        var input = finiteNumber(meta.inputTokens) || 0;
        var cached = Math.min(finiteNumber(meta.cachedInputTokens) || 0, input);
        var uncached = Math.max(0, input - cached);
        var output = finiteNumber(meta.billableOutputTokens);
        if (output == null) output = finiteNumber(meta.outputTokens) || 0;
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
            parts.push('비용 단가 미등록');
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

    function updateVisibleAiUsage() {
        var el = document.getElementById('ce-ai-reasoning-usage');
        if (!el || !LAST_AI_USAGE) return;
        el.textContent = formatReasoningUsage(LAST_AI_USAGE);
        el.title = getUsageTooltip(LAST_AI_USAGE);
        el.classList.remove('is-working');
    }

    async function callAI(provider, config, chatLog, turns, style, isCompress, options) {
        options = options || {};
        LAST_AI_USAGE = null;
        const promptMode = isCompress ? 'compress' : 'main';
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
            const generationConfig = { temperature:0.2, topK:40, topP:0.8 };
            const thinkingConfig = getGeminiThinkingConfig(config.model, reasoningValue);
            if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig;
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
            const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts
                ? data.candidates[0].content.parts : [];
            const text = parts.filter(function(part) { return !part.thought; }).map(function(part) { return part.text || ''; }).join('');
            if (!text.trim()) throw new Error('Gemini 응답에 텍스트가 없습니다.');
            const usage = data.usageMetadata || {};
            setLastAiUsage(provider, config.model, reasoningValue, {
                inputTokens:usage.promptTokenCount,
                visibleOutputTokens:usage.candidatesTokenCount,
                reasoningTokens:usage.thoughtsTokenCount,
                outputTokens:(finiteNumber(usage.candidatesTokenCount) || 0) + (finiteNumber(usage.thoughtsTokenCount) || 0),
                billableOutputTokens:(finiteNumber(usage.candidatesTokenCount) || 0) + (finiteNumber(usage.thoughtsTokenCount) || 0),
                totalTokens:usage.totalTokenCount,
                cachedInputTokens:usage.cachedContentTokenCount
            });
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
            const { initializeApp } = await import('https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js');
            const firebaseAiModule = await import('https://www.gstatic.com/firebasejs/12.8.0/firebase-ai.js');
            const getAI = firebaseAiModule.getAI;
            const getGenerativeModel = firebaseAiModule.getGenerativeModel;
            const VertexAIBackend = firebaseAiModule.VertexAIBackend;
            const HarmBlockThreshold = firebaseAiModule.HarmBlockThreshold;
            const HarmCategory = firebaseAiModule.HarmCategory;
            const ThinkingLevel = firebaseAiModule.ThinkingLevel || {};
            const app = initializeApp(firebaseConfig, 'crack-ext-' + Date.now());
            const ai = getAI(app, { backend:new VertexAIBackend('global') });
            const safetySettings = [
                { category:HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold:HarmBlockThreshold.OFF },
                { category:HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold:HarmBlockThreshold.OFF },
                { category:HarmCategory.HARM_CATEGORY_HARASSMENT, threshold:HarmBlockThreshold.OFF },
                { category:HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold:HarmBlockThreshold.OFF }
            ];
            const generationConfig = { temperature:0.2, topK:40, topP:0.8 };
            const rawThinkingConfig = getGeminiThinkingConfig(config.model, reasoningValue);
            if (rawThinkingConfig) {
                if (rawThinkingConfig.thinkingLevel) {
                    var enumKey = rawThinkingConfig.thinkingLevel.toUpperCase();
                    generationConfig.thinkingConfig = { thinkingLevel:ThinkingLevel[enumKey] || rawThinkingConfig.thinkingLevel };
                } else {
                    generationConfig.thinkingConfig = rawThinkingConfig;
                }
            }
            const modelWithSys = getGenerativeModel(ai, {
                model:config.model,
                systemInstruction:currentPrompt,
                safetySettings:safetySettings,
                generationConfig:generationConfig
            });
            const result = await modelWithSys.generateContent(reinforcedPrompt);
            const response = await result.response;
            const text = response.text();
            if (!text || !text.trim()) throw new Error('Firebase AI 응답에 텍스트가 없습니다.');
            const usage = response.usageMetadata || {};
            setLastAiUsage(provider, config.model, reasoningValue, {
                inputTokens:usage.promptTokenCount,
                visibleOutputTokens:usage.candidatesTokenCount,
                reasoningTokens:usage.thoughtsTokenCount,
                outputTokens:(finiteNumber(usage.candidatesTokenCount) || 0) + (finiteNumber(usage.thoughtsTokenCount) || 0),
                billableOutputTokens:(finiteNumber(usage.candidatesTokenCount) || 0) + (finiteNumber(usage.thoughtsTokenCount) || 0),
                totalTokens:usage.totalTokenCount,
                cachedInputTokens:usage.cachedContentTokenCount
            });
            return text;
        }
        throw new Error('알 수 없는 API 제공자');
    }

    function parseFirebaseConfig(scriptStr) {
        try {
            const match = scriptStr.match(/firebaseConfig\s*=\s*(\{[\s\S]*?\});/);
            if (match && match[1]) return new Function("return " + match[1])();
            if (scriptStr.includes("apiKey")) {
                const startIndex = scriptStr.indexOf("firebaseConfig = {");
                if (startIndex !== -1) {
                    const endIndex = scriptStr.indexOf("};", startIndex);
                    if (endIndex !== -1) return new Function("return " + scriptStr.substring(startIndex + 18, endIndex + 1))();
                }
            }
        } catch(e) {}
        return null;
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
.crack-ext-header-ai-btn.crack-ext-floating{position:fixed!important;right:18px!important;bottom:82px!important;z-index:99999999!important;height:36px!important;padding:0 12px!important;border-radius:999px!important;box-shadow:0 4px 14px rgba(0,0,0,.14)!important;background:#fff!important}
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
.crack-ext-header-ai-btn.crack-ext-floating{background:#FFFBF4!important;border:1px solid #D8CAB7!important;box-shadow:0 5px 18px rgba(61,43,23,.18)!important}
body[data-theme="dark"] .crack-ext-header-ai-btn,html[data-theme="dark"] .crack-ext-header-ai-btn,html[data-sgb-theme="dark"] .crack-ext-header-ai-btn{color:#C9BBA5!important}
body[data-theme="dark"] .crack-ext-header-ai-btn .crack-ext-header-ai-icon,html[data-theme="dark"] .crack-ext-header-ai-btn .crack-ext-header-ai-icon,html[data-sgb-theme="dark"] .crack-ext-header-ai-btn .crack-ext-header-ai-icon{color:#D5A052!important}
body[data-theme="dark"] .crack-ext-header-ai-btn:hover,html[data-theme="dark"] .crack-ext-header-ai-btn:hover,html[data-sgb-theme="dark"] .crack-ext-header-ai-btn:hover{background:rgba(226,168,75,.1)!important;border-color:rgba(226,168,75,.16)!important;color:#EDE5D6!important}
body[data-theme="dark"] .crack-ext-header-ai-btn.crack-ext-floating,html[data-theme="dark"] .crack-ext-header-ai-btn.crack-ext-floating,html[data-sgb-theme="dark"] .crack-ext-header-ai-btn.crack-ext-floating{background:#1D1A15!important;border-color:#3B342A!important;box-shadow:0 5px 18px rgba(0,0,0,.38)!important}
@media(max-width:820px){
#ce-ai-top-settings,#ce-ai-secondary-settings{grid-template-columns:1fr 1fr}
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
#ce-ai-top-settings,#ce-ai-secondary-settings{grid-template-columns:1fr}
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
.crack-ext-editor-card-head{align-items:flex-start;padding:10px 12px}
.crack-ext-editor-pane{padding:12px}
.crack-ext-editor-actions{justify-content:flex-end}
}
/* 모바일 가로 화면: 편집 툴바가 카드 조작 영역을 덮지 않도록 일반 스크롤로 전환 */
@media (max-height:520px) and (max-width:760px){
.crack-ext-editor-toolbar{position:static!important;top:auto!important;padding-top:0}
}
/* 768px 태블릿에서도 스크롤 중 닫기 버튼을 유지 */
@media (min-width:761px) and (max-width:820px){
.crack-ext-ai-modal-header{position:sticky;top:-24px;z-index:20}
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
        var savedModel = localStorage.getItem('crack_ext_' + provider + '_model') || '';
        sel.innerHTML = '';
        var models = [];
        if (provider === 'google') {
            models = [
                {v:'gemini-3.5-flash', t:'3.5 Flash'},
                {v:'gemini-3.1-pro-preview', t:'3.1 Pro'},
                {v:'gemini-3.1-flash-lite', t:'3.1 Flash-Lite'},
                {v:'gemini-3-pro-preview', t:'3.0 Pro'},
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

    async function updateExistingSummary(item, title, summary) {
        var id = getSummaryId(item);
        if (!id) throw new Error('장기기억 ID를 찾을 수 없습니다.');
        var res = await apiCall('PATCH', '/summaries/' + encodeURIComponent(id), { title: title, summary: summary });
        if (!res) throw new Error('수정 요청이 실패했습니다.');
        return res;
    }

    async function deleteExistingSummary(item) {
        var id = getSummaryId(item);
        if (!id) throw new Error('장기기억 ID를 찾을 수 없습니다.');
        var res = await apiCall('DELETE', '/summaries/' + encodeURIComponent(id));
        if (!res) throw new Error('삭제 요청이 실패했습니다.');
        return res;
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
            } else if (parentOverlay && parentOverlay.isConnected) {
                parentOverlay.remove();
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

        searchEl.addEventListener('input', render);
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
            var reasoning = localStorage.getItem(getReasoningStorageKey(provider, model)) || 'auto';

            btnStart.disabled = true;
            btnStart.innerHTML = UI_ICONS.flask + '<span>압축 중...</span>';

            try {
                var config = { apiKey:apiKey, model:model, firebaseScript:firebaseScript, reasoning:reasoning };
                var result = await callAI(provider, config, combinedText, 0, 'concise', true);
                var finalized = await finalizeGeneratedMemoryResult(provider, config, result, true);
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
        var savedTurns = localStorage.getItem('crack_ext_turn_count') || '15';
        var savedStyle = localStorage.getItem('crack_ext_summary_style') || 'concise';
        var currentKey = getSavedApiKey(savedProvider);

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
        html += '<div class="fg" style="flex:1.2;"><label>API</label><select id="ce-ai-provider">' +
            '<option value="google"' + (savedProvider === 'google' ? ' selected' : '') + '>Google</option>' +
            '<option value="deepseek"' + (savedProvider === 'deepseek' ? ' selected' : '') + '>DeepSeek</option>' +
            '<option value="openai"' + (savedProvider === 'openai' ? ' selected' : '') + '>OpenAI</option>' +
            '<option value="firebase"' + (savedProvider === 'firebase' ? ' selected' : '') + '>Firebase</option>' +
            '</select></div>';
        html += '<div class="fg" id="ce-ai-key-wrap" style="flex:2;' + (savedProvider === 'firebase' ? 'display:none' : '') + '"><label>API Key</label><input type="password" id="ce-ai-key" value="' + escapeHtml(currentKey) + '"></div>';
        html += '<div class="fg" id="ce-ai-firebase-wrap" style="flex:2;' + (savedProvider === 'firebase' ? '' : 'display:none') + '"><label>Firebase Script</label><input type="text" id="ce-ai-firebase-script" value=""></div>';
        html += '<div class="fg" style="flex:1.5;"><label>모델</label><select id="ce-ai-model"></select></div>';
        html += '<div class="fg" style="flex:.8;"><label>턴 수</label><input type="number" id="ce-ai-turns" value="' + escapeHtml(savedTurns) + '" min="0"></div>';
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
        html += '<div class="crack-ext-prompt-field"><span class="crack-ext-prompt-field-label">프롬프트 종류</span><select id="ce-ai-prompt-mode"><option value="main"' + (promptMode === 'main' ? ' selected' : '') + '>1차 요약</option><option value="compress"' + (promptMode === 'compress' ? ' selected' : '') + '>2차 압축</option></select></div>';
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
        var inputTurns = overlay.querySelector('#ce-ai-turns');
        var keyWrap = overlay.querySelector('#ce-ai-key-wrap');
        var firebaseWrap = overlay.querySelector('#ce-ai-firebase-wrap');
        var topSettings = overlay.querySelector('#ce-ai-top-settings');
        var secondarySettings = overlay.querySelector('#ce-ai-secondary-settings');

        // 저장된 Firebase 코드는 HTML 속성에 끼워 넣지 않고 DOM 값으로 복원한다.
        // 설정 안의 큰따옴표가 value 속성을 중간에서 닫아 내용을 잘라먹는 문제를 방지한다.
        inputFirebase.value = savedFirebaseScript;
        updateModelOptions(savedProvider);
        if (prefillText && LAST_AI_USAGE) { reasoningUsageEl.textContent = formatReasoningUsage(LAST_AI_USAGE); reasoningUsageEl.title = getUsageTooltip(LAST_AI_USAGE); }

        function updateReasoningUsage(meta, working) {
            reasoningUsageEl.textContent = meta ? formatReasoningUsage(meta) : '';
            reasoningUsageEl.title = meta ? getUsageTooltip(meta) : '';
            reasoningUsageEl.classList.toggle('is-working', !!working);
        }

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
                localStorage.setItem('crack_ext_firebase_script', inputFirebase.value || '');
            } else {
                saveApiKey(provider, inputKey.value || '');
            }
        }
        function bindAutoSave(input, handler) {
            ['input','change','keyup','blur'].forEach(function(eventName) { input.addEventListener(eventName, handler); });
            input.addEventListener('paste', function() { setTimeout(handler, 0); setTimeout(handler, 120); });
        }
        bindAutoSave(inputKey, function() { saveVisibleCredentials(activeCredentialProvider); });
        bindAutoSave(inputFirebase, function() { localStorage.setItem('crack_ext_firebase_script', inputFirebase.value || ''); });

        selProvider.onchange = function() {
            saveVisibleCredentials(activeCredentialProvider);
            var provider = selProvider.value;
            activeCredentialProvider = provider;
            localStorage.setItem('crack_ext_api_provider', provider);
            if (provider === 'firebase') {
                keyWrap.style.display = 'none';
                firebaseWrap.style.display = 'block';
                inputFirebase.value = localStorage.getItem('crack_ext_firebase_script') || '';
            } else {
                keyWrap.style.display = 'block';
                firebaseWrap.style.display = 'none';
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

        txtResult.addEventListener('input', function() {
            updatePreviewCards();
            if (!isPromptMode && !isGenerating) saveAiResultDraft(txtResult.value, resultMode);
        });
        btnCardPrev.onclick = function(e) { e.preventDefault(); if (currentCardIndex > 0) { currentCardIndex--; updatePreviewCards(); } };
        btnCardNext.onclick = function(e) { e.preventDefault(); if (currentCardIndex < parsedCards.length - 1) { currentCardIndex++; updatePreviewCards(); } };

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
            if (hasUnsavedPromptText() && !(await showUiConfirm('저장하지 않은 프롬프트 수정이 있습니다. 창을 닫을까요?', '저장하지 않은 변경사항', { confirmText:'닫기', danger:true }))) return;
            if (!isGenerating) saveAiResultDraft(isPromptMode ? tempResultContent : txtResult.value, resultMode);
            overlay.remove();
        }
        btnXClose.onclick = function(e) { e.stopPropagation(); closeMainModal(); };
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) closeMainModal();
        });

        btnCompress.onclick = function(e) {
            e.stopPropagation();
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
            var model = selModel.value;
            var turnsVal = parseInt(inputTurns.value, 10);
            var turns = isNaN(turnsVal) ? 15 : turnsVal;
            var style = selStyle.value;
            var reasoning = selReasoning.value || 'auto';

            if (provider !== 'firebase' && !apiKey) { await showUiAlert('API Key를 입력해주세요.', 'API Key 필요', { tone:'warning' }); return; }
            if (provider === 'firebase' && !firebaseScript) { await showUiAlert('Firebase 스크립트를 입력해주세요.', 'Firebase 설정 필요', { tone:'warning' }); return; }

            localStorage.setItem('crack_ext_api_provider', provider);
            localStorage.setItem('crack_ext_' + provider + '_model', model);
            localStorage.setItem('crack_ext_turn_count', turns.toString());
            localStorage.setItem('crack_ext_summary_style', style);
            localStorage.setItem(getReasoningStorageKey(provider, model), reasoning);
            saveApiKey(provider, apiKey);
            if (provider === 'firebase') localStorage.setItem('crack_ext_firebase_script', firebaseScript);

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
                var config = { apiKey:apiKey, model:model, firebaseScript:firebaseScript, reasoning:reasoning };
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

    function injectTopHeaderBtn() {
        var existing = document.querySelector('.crack-ext-header-ai-btn');
        if (existing) return;

        var selectors = [
            '.absolute.z-\\[5\\] .flex.gap-3.items-center',
            'header .flex.items-center',
            '[class*="z-[5]"] [class*="items-center"]',
            'main + div header',
            'header'
        ];

        var headerContainer = null;
        for (var i = 0; i < selectors.length; i++) {
            try {
                var found = document.querySelector(selectors[i]);
                if (found) { headerContainer = found; break; }
            } catch (e) {}
        }

        var aiBtn = document.createElement('button');
        aiBtn.className = 'crack-ext-header-ai-btn';
        aiBtn.type = 'button';
        aiBtn.innerHTML = '<svg class="crack-ext-header-ai-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5h10a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4.5"/></svg><span>요약</span>';
        aiBtn.title = '요약 및 장기기억 도구';
        aiBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            showMainModal();
        });

        if (headerContainer) {
            headerContainer.prepend(aiBtn);
        } else {
            aiBtn.classList.add('crack-ext-floating');
            document.body.appendChild(aiBtn);
        }
    }

    function inject() { injectAiStyles(); injectTopHeaderBtn(); }

    function start() {
        refreshUsdKrwRate(false);
        var injectScheduled = false;
        function scheduleInject() {
            if (injectScheduled) return;
            injectScheduled = true;
            requestAnimationFrame(function() {
                injectScheduled = false;
                inject();
            });
        }
        var obs = new MutationObserver(scheduleInject);
        obs.observe(document.body, { childList: true, subtree: true });
        scheduleInject();
        setInterval(scheduleInject, 2500);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
