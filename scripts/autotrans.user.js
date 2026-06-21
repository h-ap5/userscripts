// ==UserScript==
// @name         ✨크랙 초월 번역기
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  최신 메시지를 자동 감지·번역·수정 삽입. 듀얼 프롬프트 스와핑, DeepSeek 지원 및 휘발성 OOC 자동 삽입 기능 포함.
// @match        https://crack.wrtn.ai/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// @connect      generativelanguage.googleapis.com
// @connect      api.deepseek.com
// ==/UserScript==

(function () {
  'use strict';

  const API_BASE = 'https://crack-api.wrtn.ai/crack-gen';
  const CODE_BLOCK_RE = /```([\s\S]*?)```/g;
  const FENCE_OPEN_SUB = '===BLOCK_OPEN===';
  const FENCE_CLOSE_SUB = '===BLOCK_CLOSE===';
  const FIREBASE_APP_NAME = 'crack-translator-ai';
  const FIREBASE_LOCATION = 'global';

  const MODEL_PRICING = {
    'gemini-3.1-pro-preview': { input: 2.00, output: 12.00, cacheRead: 0.20, cacheWrite: 2.00 },
    'gemini-3.1-flash-lite-preview': { input: 0.25, output: 1.50, cacheRead: 0.025, cacheWrite: 0.25 },
    'gemini-3-flash-preview': { input: 0.50, output: 3.00, cacheRead: 0.05, cacheWrite: 0.50 },
    'gemini-3.5-flash': { input: 1.50, output: 9.00, cacheRead: 0.15, cacheWrite: 1.50 },
    'gemini-2.5-pro': { input: 1.25, output: 10.00, cacheRead: 0.125, cacheWrite: 1.25 },
    'gemini-2.5-flash': { input: 0.30, output: 2.50, cacheRead: 0.03, cacheWrite: 0.30 },
    'deepseek-chat': { input: 0.14, output: 0.28, cacheRead: 0.014, cacheWrite: 0.14 },
    'deepseek-reasoner': { input: 0.55, output: 2.19, cacheRead: 0.055, cacheWrite: 0.55 },
  };

  // 1. 한글 전용 기본 프롬프트
  const promptKo = `[역할 및 목적]
당신은 최상급 웹소설 작가이자 인공지능 캐릭터 롤플레잉 전담 '초월 번역가'입니다. 제공되는 외국어 텍스트를 단순 기계 번역하는 것을 넘어, 캐릭터의 영혼과 감정, 문체, 그리고 상황적 맥락이 생생하게 호흡하는 완벽한 한국어 웹소설 문체로 재창조하는 것이 당신의 유일한 목표입니다.

[핵심 번역 원칙: 초월 번역]
1. 완벽한 탈(脫)번역투: 대명사 사용을 극도로 제한하고 호칭으로 대체. 수동태는 능동태로.
2. 지문과 대사의 극적 분리: 지문은 시각적/은유적으로, 대사는 생동감 있게.
- 번역 외의 부연 설명 절대 금지. 원문의 마크다운, 링크, *,\`등 기호 및 기존 구조 형태 반드시 유지.
3. 형식 오류 수정: 한국어 외 다른 언어가 혼합되었을시, 한국어를 번역하여 모든 텍스트를 아래 형식에 맞추어 자연스럽게 번역한다:
- 대사 형식: "KR text"
- 대사 이외의 모든 묘사 및 서술 형식: *KR description or narration* 형식으로 출력하십시오.
자주 나는 형식 오류 검토: 3-1. ""인 따옴표 안과 ** 안에 한국어 이외의 언어가 들어가진 않았는가? 3-2. 대사가 아닌 지문 묘사에 **가 없는가? -> 없다면 추가. 대사 이외의 모든 text는 **로 감싸야 한다. 3-3. 한국어 번역이 의역이 아닌 부자연스러운 기계식 직역 번역인가? -> 자연스러운 의역·영어권 문화를 고려한 번역으로 정정 3-5. 지문 안 (**안) 내용에 "한국어에서 영어" 또는 "영어에서 한국어" 와 비슷한 내용이 있는가? -> 해당 내용을 삭제 후 자연스러운 지문 묘사가 될 수 있게끔 변경 및 수정.`;

  // 2. 영문 혼용 기본 프롬프트
  const promptEn = `[역할 및 목적]
당신은 최상급 웹소설 작가이자 인공지능 캐릭터 롤플레잉 전담 '초월 번역가'입니다. 제공되는 외국어 텍스트를 단순 기계 번역하는 것을 넘어, 캐릭터의 영혼과 감정, 문체, 그리고 상황적 맥락이 생생하게 호흡하는 완벽한 한국어 웹소설 문체로 재창조하는 것이 당신의 유일한 목표입니다.

[핵심 번역 원칙: 초월 번역]
1. 완벽한 탈(脫)번역투: 대명사 사용을 극도로 제한하고 호칭으로 대체. 수동태는 능동태로.
2. 지문과 대사의 극적 분리: 지문은 시각적/은유적으로, 대사는 생동감 있게.
- 번역 외의 부연 설명 절대 금지. 원문의 마크다운, 링크, *,\`등 기호 및 기존 구조 형태 반드시 유지.
3. 대사 형식 오류 수정: 영어와 한국어가 혼합되거나 한국어 대사만 나왔을 시, 한국어를 번역하여 모든 대사를 아래 형식에 맞추어 자연스럽게 번역한다:
"English text" (KR translation only)
자주 나는 형식 오류 검토: 3-1. ()인 괄호 안에 한국어 이외의 언어가 들어가진 않았는가? 3-2. ()인 괄호 안 대사 옆에 "와 같은 특수기호가 들어가있는가? -> 있다면 제거 3-3. "" 안 영어대사에 한국어가 섞이지 않았는가? 3-4. 한국어 번역의 의역이 아닌 부자연스러운 기계식 직역 번역인가? -> 자연스러운 의역·영어권 문화를 고려한 번역으로 정정 3-5. 지문 안 (**안) 내용에 "한국어에서 영어" 또는 "영어에서 한국어" 와 비슷한 내용이 있는가? -> 해당 내용을 삭제 후 자연스러운 지문 묘사가 될 수 있게끔 변경 및 수정.
- 대사 형식: 영어 대사는 "영어"(한국어) 형식으로 출력하십시오.`;

  let transHistory = [];
  let transUsageHistory = [];
  let transIndex = -1;
  let activeOriginalText = '';
  let activeChatId = '';
  let activeMsgId = '';
  let activeIsFullMode = true;
  let thinkingLevels = GM_getValue('thinkingLevels', {});
  let thinkingBudgets = GM_getValue('thinkingBudgets', {});
  let replacementSlots = sanitizeReplacementSlots(GM_getValue('replacementSlots', []));
  let nudgeTimer = null;
  let cleanupTimer = null;

  // --- OOC 자동 삽입(휘발성) 인터셉터 세팅 ---
  function injectNetworkInterceptor() {
    const _origWsSend = window.WebSocket.prototype.send;
    window.WebSocket.prototype.send = function (data) {
      const oocEnabled = GM_getValue('oocApply', false);
      const oocText = GM_getValue('oocText', '');
      if (oocEnabled && oocText && typeof data === "string" && data.includes('"send"')) {
        try {
          const bi = data.indexOf("[");
          if (bi >= 0) {
            const prefix = data.slice(0, bi);
            const arr = JSON.parse(data.slice(bi));
            if (Array.isArray(arr) && arr[0] === "send" && arr[1] && typeof arr[1].message === "string") {
              if (!arr[1].message.includes('[OOC:')) {
                arr[1].message = arr[1].message + "\n\n[OOC: " + oocText + "]";
                triggerOocCleanup();
                return _origWsSend.call(this, prefix + JSON.stringify(arr));
              }
            }
          }
        } catch (e) {}
      }
      return _origWsSend.call(this, data);
    };

    const _origFetch = window.fetch;
    window.fetch = async function (...args) {
      const oocEnabled = GM_getValue('oocApply', false);
      const oocText = GM_getValue('oocText', '');
      if (oocEnabled && oocText && args[0] && typeof args[0] === 'string' && (args[0].includes('/messages') || args[0].includes('/chat'))) {
        try {
          let opts = args[1] || {};
          if (opts.method === 'POST' && opts.body && typeof opts.body === 'string') {
            const body = JSON.parse(opts.body);
            let injected = false;
            if (Array.isArray(body.messages)) {
              for (let i = body.messages.length - 1; i >= 0; i--) {
                if (body.messages[i].role === 'user' && !body.messages[i].content.includes('[OOC:')) {
                  body.messages[i].content += "\n\n[OOC: " + oocText + "]";
                  injected = true;
                  break;
                }
              }
            } else if (body.message && typeof body.message === 'string' && !body.message.includes('[OOC:')) {
              body.message += "\n\n[OOC: " + oocText + "]";
              injected = true;
            }
            if (injected) {
              args[1].body = JSON.stringify(body);
              triggerOocCleanup();
            }
          }
        } catch (e) {}
      }
      return _origFetch.apply(this, args);
    };
  }

  // --- 과거 OOC 흔적 삭제 타이머 ---
  function triggerOocCleanup() {
    clearTimeout(cleanupTimer);
    cleanupTimer = setTimeout(async () => {
      const chatId = parsePath();
      if (chatId) {
        const oocTurns = parseInt(GM_getValue('oocTurns', 10), 10);
        try {
          const res = await fetch(`${API_BASE}/v3/chats/${chatId}/messages?limit=50`, {
            headers: buildHeaders(),
            credentials: 'include',
          });
          if (!res.ok) return;
          const json = await res.json();
          const msgs = (json.data ?? json).messages ?? [];
          const userMsgs = msgs.filter(m => m.role === 'user');

          // 지정된 턴 수보다 오래된 메시지의 OOC 삭제
          for (let i = oocTurns; i < userMsgs.length; i++) {
            const msg = userMsgs[i];
            if (msg.content && msg.content.includes('[OOC:')) {
              const cleanContent = msg.content.replace(/\n\n\[OOC:.*?\]/g, '').trim();
              if (cleanContent !== msg.content) {
                await patchMessage(chatId, msg._id || msg.id, cleanContent);
                console.log(`[Crack Translator] Cleaned up OOC marker in older message: ${msg._id || msg.id}`);
              }
            }
          }
        } catch (e) {
            console.error("[Crack Translator] OOC Cleanup failed", e);
        }
      }
    }, 4000); // 전송 4초 후 백그라운드 정리 실행
  }

  // 인터셉터 즉시 장착
  injectNetworkInterceptor();

  function normalizeUsage(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const pick = (keys) => {
      for (const k of keys) {
        const v = raw[k];
        if (typeof v === 'number') return v;
        if (typeof v === 'string' && !Number.isNaN(Number(v))) return Number(v);
      }
      return 0;
    };

    return {
      model: raw.model || '',
      inputTokens: pick(['inputTokens', 'input_tokens', 'promptTokenCount', 'prompt_token_count', 'promptTokens']),
      outputTokens: pick(['outputTokens', 'output_tokens', 'candidatesTokenCount', 'candidates_token_count']),
      cacheReadInputTokens: pick(['cacheReadInputTokens', 'cache_read_input_tokens', 'cachedContentTokenCount', 'cached_content_token_count']),
      thoughtsTokenCount: pick(['thoughtsTokenCount', 'thoughts_token_count', 'thinking_tokens']),
    };
  }

  function sanitizeReplacementSlots(rawSlots) {
    if (!Array.isArray(rawSlots)) return [];
    return rawSlots
      .map(slot => ({
        find: String(slot?.find || ''),
        replace: String(slot?.replace || ''),
      }))
      .filter(slot => slot.find);
  }

  function calculateCost(usage, exchangeRate = 1500, modelOverride = '') {
    const u = usage ? normalizeUsage(usage) : null;
    if (!u) return null;

    const modelIdRaw = u.model || modelOverride;
    const pricing = MODEL_PRICING[modelIdRaw] || MODEL_PRICING['gemini-3-flash-preview'];
    if (!pricing) return null;

    const thoughtsTokens = u.thoughtsTokenCount || 0;
    const cacheReadTokens = u.cacheReadInputTokens || 0;
    const totalInputTokens = u.inputTokens || 0;
    const totalOutputTokens = u.outputTokens || 0;
    const actualOutputTokens = thoughtsTokens > 0 && totalOutputTokens >= thoughtsTokens
      ? totalOutputTokens - thoughtsTokens
      : totalOutputTokens;

    const uncachedInputTokens = Math.max(0, totalInputTokens - cacheReadTokens);
    const readCost = (cacheReadTokens * pricing.cacheRead) / 1000000;
    const writeCost = (uncachedInputTokens * pricing.cacheWrite) / 1000000;
    const outputCost = (actualOutputTokens * pricing.output) / 1000000;
    const thoughtsCost = (thoughtsTokens * pricing.output) / 1000000;
    const totalUsd = readCost + writeCost + outputCost + thoughtsCost;

    return {
      usd: totalUsd,
      krw: totalUsd * exchangeRate,
      tokens: {
        read: cacheReadTokens,
        write: uncachedInputTokens,
        output: actualOutputTokens,
        thoughts: thoughtsTokens,
      },
    };
  }

  function addStyles() {
    const style = document.createElement('style');
    style.textContent = `
#trans-setting-panel,
#trans-result-modal,
#trans-nudge {
  --t-bg: #ffffff;
  --t-surface: #f7f7f5;
  --t-raised: #ffffff;
  --t-border: #d9d7cf;
  --t-accent: #6a3de8;
  --t-accent2: #7c5cfc;
  --t-danger: #d92d20;
  --t-success: #07845f;
  --t-warn: #9a6700;
  --t-tx1: #1a1918;
  --t-tx2: #62605a;
  --t-tx3: #85837d;
  --t-shadow: 0 24px 60px rgba(20, 20, 20, .22), 0 4px 16px rgba(20, 20, 20, .14);
  --t-font: "Noto Sans KR", "Apple SD Gothic Neo", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
}

#trans-setting-panel.trans-theme-dark,
#trans-result-modal.trans-theme-dark,
#trans-nudge.trans-theme-dark {
  --t-bg: #111113;
  --t-surface: #18181c;
  --t-raised: #202026;
  --t-border: #2e2e38;
  --t-accent: #8b6ffc;
  --t-accent2: #b4a0ff;
  --t-danger: #f87171;
  --t-success: #34d399;
  --t-warn: #fbbf24;
  --t-tx1: #eeedf2;
  --t-tx2: #aaa7b8;
  --t-tx3: #777486;
  --t-shadow: 0 24px 60px rgba(0, 0, 0, .72), 0 4px 12px rgba(0, 0, 0, .5);
}

#trans-setting-panel {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 2147483647 !important;
  display: none;
  width: 370px;
  max-width: calc(100vw - 28px);
  max-height: 75vh;
  overflow-y: auto;
  background: var(--t-bg);
  border: 1px solid var(--t-border);
  border-radius: 14px;
  box-shadow: var(--t-shadow);
  font-family: var(--t-font);
  color: var(--t-tx1);
}

#trans-panel-header {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--t-bg);
  border-bottom: 1px solid var(--t-border);
  padding: 16px 18px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

#trans-panel-header h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--t-tx1);
}

#trans-close-settings-btn {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid var(--t-border);
  background: var(--t-raised);
  color: var(--t-tx2);
  cursor: pointer;
  font-size: 13px;
}

#trans-panel-body {
  padding: 16px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.t-section {
  background: var(--t-surface);
  border: 1px solid var(--t-border);
  border-radius: 10px;
  padding: 13px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.t-section-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--t-tx3);
}

.t-field {
  display: flex;
  flex-direction: column;
}

.trans-label {
  display: block;
  margin-bottom: 5px;
  color: var(--t-tx2);
  font-size: 12px;
  font-weight: 600;
}

#trans-api-provider,
#trans-api-key,
#trans-firebase-script,
#trans-model-select,
#trans-mode-select,
#trans-custom-prompt,
#trans-replace-find,
#trans-replace-with,
#trans-slot-find,
#trans-slot-with,
#g-think-val,
#trans-modal-model,
#trans-ooc-text,
#trans-ooc-turns {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  background: var(--t-raised);
  border: 1px solid var(--t-border);
  border-radius: 8px;
  color: var(--t-tx1);
  font-family: var(--t-font);
  font-size: 13px;
  outline: none;
}

#trans-api-provider:focus,
#trans-api-key:focus,
#trans-firebase-script:focus,
#trans-model-select:focus,
#trans-mode-select:focus,
#trans-custom-prompt:focus,
#g-think-val:focus,
#trans-modal-model:focus,
#trans-ooc-text:focus,
#trans-ooc-turns:focus {
  border-color: var(--t-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--t-accent) 20%, transparent);
}

.t-select-arrow {
  appearance: none;
  -webkit-appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, var(--t-tx2) 50%), linear-gradient(135deg, var(--t-tx2) 50%, transparent 50%);
  background-position: calc(100% - 16px) 50%, calc(100% - 11px) 50%;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
  padding-right: 30px !important;
}

#trans-custom-prompt,
#trans-firebase-script,
#trans-ooc-text {
  resize: vertical;
  min-height: 76px;
  line-height: 1.55;
}

#trans-custom-prompt {
  min-height: 118px;
}

.t-check-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--t-border);
  border-radius: 8px;
  background: var(--t-raised);
  color: var(--t-tx1);
  cursor: pointer;
  user-select: none;
}

.t-check-row input {
  width: 16px;
  height: 16px;
  margin-top: 2px;
  accent-color: var(--t-accent);
}

.t-check-title {
  display: block;
  font-size: 13px;
  font-weight: 700;
}

.t-check-desc {
  display: block;
  margin-top: 2px;
  color: var(--t-tx3);
  font-size: 11px;
  line-height: 1.45;
}

.t-inline-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 7px;
  align-items: center;
}

.t-mini-btn {
  min-height: 35px;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--t-border);
  background: var(--t-raised);
  color: var(--t-tx1);
  cursor: pointer;
  font-family: var(--t-font);
  font-size: 12px;
  font-weight: 800;
}

.t-mini-btn.primary {
  background: var(--t-accent);
  border-color: var(--t-accent);
  color: #fff;
}

.t-slot-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 28px;
}

.t-slot-empty {
  color: var(--t-tx3);
  font-size: 12px;
  line-height: 28px;
}

.t-slot-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  min-height: 28px;
  padding: 5px 8px;
  border-radius: 999px;
  border: 1px solid var(--t-border);
  background: var(--t-raised);
  color: var(--t-tx1);
  font-size: 12px;
  font-weight: 700;
}

.t-slot-chip button {
  border: none;
  background: transparent;
  color: var(--t-tx3);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}

.t-replace-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--t-border);
  border-radius: 10px;
  background: var(--t-surface);
}

.t-replace-panel-title {
  color: var(--t-tx2);
  font-size: 12px;
  font-weight: 800;
}

.t-modal-slots {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.t-apply-slot {
  max-width: 100%;
  padding: 6px 9px;
  border-radius: 999px;
  border: 1px solid var(--t-border);
  background: var(--t-raised);
  color: var(--t-tx1);
  cursor: pointer;
  font-family: var(--t-font);
  font-size: 12px;
  font-weight: 800;
}

.t-btn-row {
  display: flex;
  gap: 8px;
}

.t-btn,
#trans-direct-apply-btn,
#trans-close-modal,
#trans-patch-modal,
#trans-reroll-btn,
.trans-nav-btn {
  font-family: var(--t-font);
  transition: opacity .15s, transform .08s, background .15s, border-color .15s;
}

.t-btn {
  flex: 1;
  padding: 9px 13px;
  border-radius: 8px;
  border: 1px solid var(--t-border);
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
}

.t-btn:active,
#trans-direct-apply-btn:active,
#trans-patch-modal:active {
  transform: scale(.98);
}

.t-btn:disabled,
#trans-direct-apply-btn:disabled,
#trans-patch-modal:disabled,
#trans-reroll-btn:disabled,
.trans-nav-btn:disabled {
  opacity: .45;
  cursor: not-allowed;
}

.t-btn-ghost {
  background: var(--t-raised);
  color: var(--t-tx2);
}

.t-btn-primary,
#trans-direct-apply-btn,
#trans-patch-modal {
  background: var(--t-accent);
  border: 1px solid var(--t-accent);
  color: #fff;
}

#trans-direct-apply-btn {
  width: 100%;
  padding: 11px 13px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 800;
}

#trans-status-box {
  display: none;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
  background: var(--t-raised);
  border: 1px solid var(--t-border);
  color: var(--t-tx2);
}

#trans-status-box.active {
  display: block;
}

#trans-status-box.ok {
  border-color: color-mix(in srgb, var(--t-success) 45%, var(--t-border));
  color: var(--t-success);
}

#trans-status-box.err {
  border-color: color-mix(in srgb, var(--t-danger) 45%, var(--t-border));
  color: var(--t-danger);
}

#trans-status-box.info {
  border-color: color-mix(in srgb, var(--t-accent) 45%, var(--t-border));
  color: var(--t-accent2);
}

#trans-result-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483646 !important;
  display: none;
  background: rgba(0, 0, 0, .42);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

#trans-result-overlay.trans-theme-dark {
  background: rgba(0, 0, 0, .65);
}

#trans-result-modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 2147483647 !important;
  display: none;
  flex-direction: column;
  width: min(680px, calc(100vw - 28px));
  max-height: calc(100vh - 28px);
  background: var(--t-bg);
  border: 1px solid var(--t-border);
  border-radius: 14px;
  box-shadow: var(--t-shadow);
  font-family: var(--t-font);
  color: var(--t-tx1);
  overflow: hidden;
}

.t-modal-header,
.t-modal-footer {
  background: var(--t-surface);
  border-color: var(--t-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.t-modal-header {
  padding: 15px 18px;
  border-bottom: 1px solid var(--t-border);
}

.t-modal-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 800;
  color: var(--t-tx1);
}

.t-modal-title-badge {
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--t-accent) 30%, var(--t-border));
  color: var(--t-accent2);
  font-size: 11px;
  font-weight: 700;
}

.t-reroll-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

#trans-modal-model {
  width: 150px;
  font-size: 12px;
}

#trans-reroll-btn {
  padding: 8px 12px;
  border: 1px solid var(--t-border);
  border-radius: 8px;
  background: var(--t-raised);
  color: var(--t-tx1);
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}

.t-modal-body {
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

#trans-result-content {
  width: 100%;
  box-sizing: border-box;
  height: 38vh;
  min-height: 180px;
  resize: vertical;
  padding: 13px 15px;
  background: var(--t-surface);
  border: 1px solid var(--t-border);
  border-radius: 10px;
  color: var(--t-tx1);
  font-family: var(--t-font);
  font-size: 14px;
  line-height: 1.72;
  outline: none;
}

#trans-result-content:focus {
  border-color: var(--t-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--t-accent) 18%, transparent);
}

#trans-cost-info {
  min-height: 16px;
  color: var(--t-tx3);
  font-size: 11px;
  line-height: 1.4;
}

#trans-cost-info:not(:empty) {
  color: var(--t-warn);
}

.t-modal-footer {
  padding: 13px 18px;
  border-top: 1px solid var(--t-border);
  flex-wrap: wrap;
}

.t-history-nav,
.t-modal-action-row {
  display: flex;
  align-items: center;
  gap: 7px;
}

.trans-nav-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--t-border);
  background: var(--t-raised);
  color: var(--t-tx2);
  cursor: pointer;
}

#trans-history-count {
  min-width: 44px;
  text-align: center;
  color: var(--t-tx2);
  font-size: 12px;
  font-weight: 700;
}

#trans-close-modal,
#trans-patch-modal {
  padding: 9px 15px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 800;
}

#trans-close-modal {
  border: 1px solid var(--t-border);
  background: var(--t-raised);
  color: var(--t-tx2);
}

#trans-nudge {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translate(-50%, 14px);
  z-index: 2147483647 !important;
  max-width: min(460px, calc(100vw - 28px));
  padding: 11px 14px;
  border-radius: 10px;
  border: 1px solid var(--t-border);
  background: var(--t-bg);
  box-shadow: var(--t-shadow);
  color: var(--t-tx1);
  font-family: var(--t-font);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.45;
  opacity: 0;
  pointer-events: none;
}

#trans-nudge.active {
  opacity: 1;
  transform: translate(-50%, 0);
}

#trans-nudge.info {
  border-color: color-mix(in srgb, var(--t-accent) 45%, var(--t-border));
  color: var(--t-accent2);
}

#trans-nudge.ok {
  border-color: color-mix(in srgb, var(--t-success) 45%, var(--t-border));
  color: var(--t-success);
}

#trans-nudge.err {
  border-color: color-mix(in srgb, var(--t-danger) 45%, var(--t-border));
  color: var(--t-danger);
}

@media (max-width: 560px) {
  .t-modal-header,
  .t-modal-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .t-reroll-group,
  .t-modal-action-row {
    width: 100%;
  }

  #trans-modal-model,
  #trans-reroll-btn,
  #trans-close-modal,
  #trans-patch-modal {
    flex: 1;
  }

  .t-inline-form {
    grid-template-columns: 1fr;
  }
}`;
    document.head.appendChild(style);
  }

  function createUI() {
    const panel = document.createElement('div');
    panel.id = 'trans-setting-panel';
    panel.innerHTML = `
<div id="trans-panel-header">
  <h4>초월 번역 설정</h4>
  <button id="trans-close-settings-btn" type="button">✕</button>
</div>
<div id="trans-panel-body">
  <div class="t-section">
    <div class="t-section-title">API 설정</div>
    <div class="t-field">
      <label class="trans-label" for="trans-api-provider">제공자</label>
      <select id="trans-api-provider" class="t-select-arrow">
        <option value="google">Google API</option>
        <option value="firebase">Firebase</option>
        <option value="deepseek">DeepSeek</option>
      </select>
    </div>
    <div class="t-field">
      <label class="trans-label" id="trans-key-label" for="trans-api-key">API Key</label>
      <input type="password" id="trans-api-key" placeholder="API Key를 입력하세요">
      <textarea id="trans-firebase-script" placeholder="Firebase Config 코드를 붙여넣으세요" style="display:none;"></textarea>
    </div>
  </div>

  <div class="t-section">
    <div class="t-section-title">모델 & 추론</div>
    <div class="t-field">
      <label class="trans-label" for="trans-model-select">모델 선택</label>
      <select id="trans-model-select" class="t-select-arrow">
        <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro Preview</option>
        <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash Lite Preview</option>
        <option value="gemini-3-flash-preview">Gemini 3 Flash Preview</option>
        <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
        <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
        <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
        <option value="deepseek-chat">DeepSeek V3 (Chat)</option>
        <option value="deepseek-reasoner">DeepSeek R1 (Reasoner)</option>
      </select>
    </div>
    <div id="trans-thinking-container" data-current-model=""></div>
  </div>

  <div class="t-section">
    <div class="t-section-title">번역 설정</div>
    <div class="t-field">
      <label class="trans-label" for="trans-mode-select">번역 방식</label>
      <select id="trans-mode-select" class="t-select-arrow">
        <option value="ko">한글 전용 (기본)</option>
        <option value="en">영문 혼용</option>
      </select>
    </div>
    <label class="t-check-row" for="trans-instant-apply">
      <input id="trans-instant-apply" type="checkbox">
      <span>
        <span class="t-check-title">말풍선 ✨ 클릭 시 즉시 교체</span>
        <span class="t-check-desc">체크하면 결과 팝업 없이 최신 메시지를 바로 패치하고 예상 금액을 nudge로 보여줍니다.</span>
      </span>
    </label>
    <div class="t-field">
      <label class="trans-label" for="trans-custom-prompt">번역 지침서</label>
      <textarea id="trans-custom-prompt" rows="6"></textarea>
    </div>
  </div>

  <div class="t-section">
    <div class="t-section-title">OOC 자동 주입 (휘발성)</div>
    <label class="t-check-row" for="trans-ooc-apply">
      <input id="trans-ooc-apply" type="checkbox">
      <span>
        <span class="t-check-title">내 채팅에 OOC 문구 자동 삽입</span>
        <span class="t-check-desc">지정한 턴이 지나면 과거 대화 기록에서 쥐도새도 모르게 지워집니다.</span>
      </span>
    </label>
    <div class="t-field">
      <label class="trans-label" for="trans-ooc-text">OOC 문구 내용</label>
      <textarea id="trans-ooc-text" rows="3" placeholder="예: Please answer in English OOC."></textarea>
    </div>
    <div class="t-field">
      <label class="trans-label" for="trans-ooc-turns">유지할 턴 수</label>
      <input type="number" id="trans-ooc-turns" min="1" value="10">
    </div>
  </div>

  <div class="t-section">
    <div class="t-section-title">키워드 치환 슬롯</div>
    <div class="t-inline-form">
      <input id="trans-slot-find" type="text" placeholder="찾을 말">
      <input id="trans-slot-with" type="text" placeholder="바꿀 말">
      <button class="t-mini-btn primary" id="trans-add-slot-btn" type="button">추가</button>
    </div>
    <div class="t-slot-list" id="trans-slot-list"></div>
  </div>

  <div class="t-btn-row">
    <button class="t-btn t-btn-ghost" id="trans-reset-btn" type="button">↺ 초기화</button>
    <button class="t-btn t-btn-primary" id="trans-save-btn" type="button">저장</button>
  </div>

  <button id="trans-direct-apply-btn" type="button" style="display: none;">✨ 최신 답변 바로 번역 (팝업 없이)</button>
  <div id="trans-status-box"></div>
</div>`;
    document.body.appendChild(panel);

    const overlay = document.createElement('div');
    overlay.id = 'trans-result-overlay';
    document.body.appendChild(overlay);

    const resultModal = document.createElement('div');
    resultModal.id = 'trans-result-modal';
    resultModal.innerHTML = `
<div class="t-modal-header">
  <div class="t-modal-title">✨ 번역 결과 <span class="t-modal-title-badge">초월 번역</span></div>
  <div class="t-reroll-group">
    <select id="trans-modal-model" class="t-select-arrow">
      <option value="gemini-3.1-pro-preview">3.1 Pro</option>
      <option value="gemini-3.1-flash-lite-preview">3.1 Flash Lite</option>
      <option value="gemini-3-flash-preview">3 Flash</option>
      <option value="gemini-3.5-flash">3.5 Flash</option>
      <option value="gemini-2.5-pro">2.5 Pro</option>
      <option value="gemini-2.5-flash">2.5 Flash</option>
      <option value="deepseek-chat">DeepSeek V3</option>
      <option value="deepseek-reasoner">DeepSeek R1</option>
    </select>
    <button id="trans-reroll-btn" type="button">↻ 다시 돌리기</button>
  </div>
</div>
<div class="t-modal-body">
  <textarea id="trans-result-content" placeholder="번역 결과가 여기에 표시됩니다..."></textarea>
  <div class="t-replace-panel">
    <div class="t-replace-panel-title">키워드 전체 교체</div>
    <div class="t-inline-form">
      <input id="trans-replace-find" type="text" placeholder="찾을 말">
      <input id="trans-replace-with" type="text" placeholder="바꿀 말">
      <button class="t-mini-btn primary" id="trans-apply-replace-btn" type="button">전체 교체</button>
    </div>
    <div class="t-modal-slots" id="trans-modal-slot-list"></div>
  </div>
  <div id="trans-cost-info"></div>
</div>
<div class="t-modal-footer">
  <div class="t-history-nav">
    <button class="trans-nav-btn" id="trans-prev-btn" type="button" aria-label="이전">◀</button>
    <span id="trans-history-count">1 / 1</span>
    <button class="trans-nav-btn" id="trans-next-btn" type="button" aria-label="다음">▶</button>
  </div>
  <div class="t-modal-action-row">
    <button id="trans-close-modal" type="button">닫기</button>
    <button id="trans-patch-modal" type="button">이 결과로 교체하기</button>
  </div>
</div>`;
    document.body.appendChild(resultModal);

    const nudge = document.createElement('div');
    nudge.id = 'trans-nudge';
    document.body.appendChild(nudge);

    syncTranslatorTheme();
    bindUIEvents();
  }

  function bindUIEvents() {
    const apiProviderSelect = document.getElementById('trans-api-provider');
    const apiKeyInput = document.getElementById('trans-api-key');
    const firebaseScriptInput = document.getElementById('trans-firebase-script');
    const keyLabel = document.getElementById('trans-key-label');
    const modelSelect = document.getElementById('trans-model-select');
    const modeSelect = document.getElementById('trans-mode-select');
    const customPromptInput = document.getElementById('trans-custom-prompt');
    const thinkContainer = document.getElementById('trans-thinking-container');
    const instantApplyInput = document.getElementById('trans-instant-apply');
    const slotFindInput = document.getElementById('trans-slot-find');
    const slotWithInput = document.getElementById('trans-slot-with');
    const addSlotBtn = document.getElementById('trans-add-slot-btn');
    const saveBtn = document.getElementById('trans-save-btn');
    const resetBtn = document.getElementById('trans-reset-btn');
    const directApplyBtn = document.getElementById('trans-direct-apply-btn');
    const closeSettingsBtn = document.getElementById('trans-close-settings-btn');
    const statusBox = document.getElementById('trans-status-box');
    const resultContent = document.getElementById('trans-result-content');
    const replaceFindInput = document.getElementById('trans-replace-find');
    const replaceWithInput = document.getElementById('trans-replace-with');
    const applyReplaceBtn = document.getElementById('trans-apply-replace-btn');
    const closeModalBtn = document.getElementById('trans-close-modal');
    const patchModalBtn = document.getElementById('trans-patch-modal');
    const modalModelSelect = document.getElementById('trans-modal-model');
    const rerollBtn = document.getElementById('trans-reroll-btn');
    const prevBtn = document.getElementById('trans-prev-btn');
    const nextBtn = document.getElementById('trans-next-btn');

    // OOC 변수
    const oocApplyInput = document.getElementById('trans-ooc-apply');
    const oocTextInput = document.getElementById('trans-ooc-text');
    const oocTurnsInput = document.getElementById('trans-ooc-turns');

    apiProviderSelect.value = GM_getValue('apiProvider', 'google');
    apiKeyInput.value = GM_getValue('apiKey', '');
    firebaseScriptInput.value = GM_getValue('firebaseScript', '');
    modelSelect.value = GM_getValue('apiModel', 'gemini-2.5-pro');
    instantApplyInput.checked = GM_getValue('instantApply', false);
    modalModelSelect.value = modelSelect.value;

    oocApplyInput.checked = GM_getValue('oocApply', false);
    oocTextInput.value = GM_getValue('oocText', 'Please reply in English OOC.');
    oocTurnsInput.value = GM_getValue('oocTurns', 10);

    let savedMode = GM_getValue('transMode', 'ko');
    modeSelect.value = savedMode;

    let currentPrompts = {
      ko: GM_getValue('customPromptKo', promptKo),
      en: GM_getValue('customPromptEn', promptEn)
    };

    const legacyPrompt = GM_getValue('customPrompt', '');
    if (legacyPrompt) {
      currentPrompts[savedMode] = legacyPrompt;
      GM_setValue('customPrompt', '');
    }

    customPromptInput.value = currentPrompts[savedMode];

    const toggleProviderUI = () => {
      const isFirebase = apiProviderSelect.value === 'firebase';
      const isDeepSeek = apiProviderSelect.value === 'deepseek';

      apiKeyInput.style.display = isFirebase ? 'none' : 'block';
      firebaseScriptInput.style.display = isFirebase ? 'block' : 'none';

      if (isFirebase) {
        keyLabel.textContent = 'Firebase Config';
        keyLabel.setAttribute('for', 'trans-firebase-script');
      } else if (isDeepSeek) {
        keyLabel.textContent = 'DeepSeek API Key';
        keyLabel.setAttribute('for', 'trans-api-key');
      } else {
        keyLabel.textContent = 'Google API Key';
        keyLabel.setAttribute('for', 'trans-api-key');
      }
    };

    function saveThinkVal(model) {
      if (!model) return;
      const input = document.getElementById('g-think-val');
      if (!input) return;

      if (model.includes('gemini-3')) {
        thinkingLevels[model] = input.value;
      } else if (model.includes('gemini-2.5')) {
        let val = parseInt(input.value, 10) || 1024;
        if (val < 128) val = 128;
        thinkingBudgets[model] = val;
      }
    }

    function updateThinkingUI() {
      const currentModel = modelSelect.value;
      let html = '';

      if (currentModel.includes('gemini-3')) {
        let currentLevel = thinkingLevels[currentModel] || 'medium';
        const labelPrefix = currentModel.includes('pro') ? '3.1 Pro' : 'Flash';
        if (currentModel.includes('pro') && currentLevel === 'minimal') currentLevel = 'low';
        const opts = currentModel.includes('pro')
          ? `<option value="low" ${currentLevel === 'low' ? 'selected' : ''}>Low</option>
             <option value="medium" ${currentLevel === 'medium' ? 'selected' : ''}>Medium</option>
             <option value="high" ${currentLevel === 'high' ? 'selected' : ''}>High</option>`
          : `<option value="minimal" ${currentLevel === 'minimal' ? 'selected' : ''}>Minimal</option>
             <option value="low" ${currentLevel === 'low' ? 'selected' : ''}>Low</option>
             <option value="medium" ${currentLevel === 'medium' ? 'selected' : ''}>Medium</option>
             <option value="high" ${currentLevel === 'high' ? 'selected' : ''}>High</option>`;

        html = `<div class="t-field">
          <label class="trans-label" for="g-think-val">🧠 ${labelPrefix} 추론 레벨</label>
          <select id="g-think-val" class="t-select-arrow">${opts}</select>
        </div>`;
      } else if (currentModel.includes('gemini-2.5')) {
        const budget = thinkingBudgets[currentModel] || 1024;
        html = `<div class="t-field">
          <label class="trans-label" for="g-think-val">🧠 2.5 추론 예산 (최소 128)</label>
          <input type="number" id="g-think-val" min="128" value="${budget}">
        </div>`;
      }

      thinkContainer.innerHTML = html;
      thinkContainer.setAttribute('data-current-model', currentModel);
    }

    const saveCurrentSettings = () => {
      saveThinkVal(thinkContainer.getAttribute('data-current-model'));
      currentPrompts[modeSelect.value] = customPromptInput.value;

      GM_setValue('apiProvider', apiProviderSelect.value);
      GM_setValue('apiKey', apiKeyInput.value.trim());
      GM_setValue('firebaseScript', firebaseScriptInput.value.trim());
      GM_setValue('apiModel', modelSelect.value);
      GM_setValue('transMode', modeSelect.value);
      GM_setValue('customPromptKo', currentPrompts.ko);
      GM_setValue('customPromptEn', currentPrompts.en);
      GM_setValue('instantApply', instantApplyInput.checked);
      GM_setValue('thinkingLevels', thinkingLevels);
      GM_setValue('thinkingBudgets', thinkingBudgets);
      GM_setValue('replacementSlots', replacementSlots);

      GM_setValue('oocApply', oocApplyInput.checked);
      GM_setValue('oocText', oocTextInput.value.trim());
      GM_setValue('oocTurns', parseInt(oocTurnsInput.value, 10) || 10);
    };

    apiProviderSelect.addEventListener('change', toggleProviderUI);

    modelSelect.addEventListener('change', () => {
      saveThinkVal(thinkContainer.getAttribute('data-current-model'));
      updateThinkingUI();
    });

    modeSelect.addEventListener('change', (e) => {
      const prevMode = e.target.value === 'en' ? 'ko' : 'en';
      currentPrompts[prevMode] = customPromptInput.value;
      customPromptInput.value = currentPrompts[e.target.value];
    });

    instantApplyInput.addEventListener('change', saveCurrentSettings);

    addSlotBtn.addEventListener('click', () => {
      const find = slotFindInput.value.trim();
      const replace = slotWithInput.value.trim();
      if (!find) {
        showNudge('찾을 말을 먼저 입력해주세요.', 'err');
        return;
      }

      const existing = replacementSlots.find(slot => slot.find === find);
      if (existing) {
        existing.replace = replace;
      } else {
        replacementSlots.push({ find, replace });
      }

      GM_setValue('replacementSlots', replacementSlots);
      slotFindInput.value = '';
      slotWithInput.value = '';
      renderReplacementSlots();
      showNudge(`치환 슬롯 저장: ${find} → ${replace}`, 'ok');
    });

    applyReplaceBtn.addEventListener('click', () => {
      applyReplacementToResult(replaceFindInput.value, replaceWithInput.value);
    });

    saveBtn.addEventListener('click', () => {
      saveCurrentSettings();
      const originalText = saveBtn.textContent;
      saveBtn.textContent = '✓ 저장 완료';
      showNudge('설정을 저장했습니다.', 'ok');
      setTimeout(() => {
        saveBtn.textContent = originalText;
      }, 1200);
    });

    resetBtn.addEventListener('click', () => {
      if (confirm('지침서를 현재 선택된 방식의 기본값으로 초기화할까요?')) {
        const currentMode = modeSelect.value;
        const defaultPrompt = currentMode === 'en' ? promptEn : promptKo;
        customPromptInput.value = defaultPrompt;
        currentPrompts[currentMode] = defaultPrompt;
      }
    });

    closeSettingsBtn.addEventListener('click', () => {
      document.getElementById('trans-setting-panel').style.display = 'none';
    });

    closeModalBtn.addEventListener('click', closeResultModal);
    document.getElementById('trans-result-overlay').addEventListener('click', closeResultModal);

    prevBtn.addEventListener('click', () => {
      if (transIndex > 0) {
        transIndex -= 1;
        renderModalState();
      }
    });

    nextBtn.addEventListener('click', () => {
      if (transIndex < transHistory.length - 1) {
        transIndex += 1;
        renderModalState();
      }
    });

    rerollBtn.addEventListener('click', async () => {
      try {
        rerollBtn.textContent = '생성 중...';
        rerollBtn.disabled = true;
        saveCurrentSettings();
        showNudge('다시 번역 중...', 'info', true);

        const resultObj = await callGemini(activeOriginalText, modalModelSelect.value);
        transHistory.push(resultObj.text);
        transUsageHistory.push({ usage: resultObj.usage, model: resultObj.model });
        transIndex = transHistory.length - 1;
        renderModalState();
        showNudge('재번역이 완료되었습니다.', 'ok');
      } catch (e) {
        showNudge(e.message, 'err');
        alert(e.message);
      } finally {
        rerollBtn.textContent = '↻ 다시 돌리기';
        rerollBtn.disabled = false;
      }
    });

    patchModalBtn.addEventListener('click', async () => {
      if (transHistory.length === 0) return;

      try {
        patchModalBtn.textContent = '교체 중...';
        patchModalBtn.disabled = true;
        showNudge('번역문을 교체 중...', 'info', true);

        const currentTranslatedText = resultContent.value;
        transHistory[transIndex] = currentTranslatedText;

        const { allMsgs, content: latestOriginal } = await fetchLatestBotMessage(activeChatId);
        const targetMsg = findMessageById(allMsgs, activeMsgId);
        const original = targetMsg?.content || latestOriginal;
        let newContent = currentTranslatedText;
        if (!activeIsFullMode && activeOriginalText !== original) {
          if (!original.includes(activeOriginalText)) {
            throw new Error('선택한 원문을 최신 답변에서 찾을 수 없습니다.');
          }
          newContent = original.replace(activeOriginalText, currentTranslatedText);
        }

        await patchMessage(activeChatId, activeMsgId, newContent);
        patchModalBtn.textContent = '✓ 완료! (새로고침 하세요)';
        showNudge('교체 완료! 새로고침하면 반영됩니다.', 'ok');
        setTimeout(() => {
          closeResultModal();
          patchModalBtn.disabled = false;
          patchModalBtn.textContent = '이 결과로 교체하기';
        }, 1600);
      } catch (e) {
        showNudge(e.message, 'err');
        alert(e.message);
        patchModalBtn.textContent = '이 결과로 교체하기';
        patchModalBtn.disabled = false;
      }
    });

    if (directApplyBtn) {
      directApplyBtn.addEventListener('click', async () => {
        const chatId = parsePath();
        if (!chatId) {
          alert('채팅방에서만 사용 가능합니다.');
          return;
        }

        saveCurrentSettings();
        directApplyBtn.disabled = true;
        statusBox.className = 'info active';
        statusBox.textContent = '메시지 탐색 및 번역 중...';
        showNudge('최신 답변 번역 중...', 'info', true);

        try {
          const { id: msgId, content: original } = await fetchLatestBotMessage(chatId);
          if (!original.trim()) throw new Error('번역할 내용이 없습니다.');

          const resultObj = await callGemini(original);
          await patchMessage(chatId, msgId, resultObj.text);

          const costMsg = formatCostForMessage(resultObj.usage, resultObj.model);
          statusBox.className = 'ok active';
          statusBox.textContent = '번역 교체 완료! 새로고침 하세요.' + costMsg;
          showNudge('번역 교체 완료! 새로고침 하세요.' + costMsg, 'ok');
        } catch (e) {
          statusBox.className = 'err active';
          statusBox.textContent = e.message;
          showNudge(e.message, 'err');
        } finally {
          directApplyBtn.disabled = false;
        }
      });
    }

    toggleProviderUI();
    updateThinkingUI();
    renderReplacementSlots();
  }

  function renderModalState() {
    if (transHistory.length === 0) return;

    const resultContent = document.getElementById('trans-result-content');
    const costInfo = document.getElementById('trans-cost-info');
    const historyCount = document.getElementById('trans-history-count');
    const prevBtn = document.getElementById('trans-prev-btn');
    const nextBtn = document.getElementById('trans-next-btn');

    resultContent.value = transHistory[transIndex];

    let costText = '';
    const usageData = transUsageHistory[transIndex];
    if (usageData && usageData.usage) {
      const costData = calculateCost(usageData.usage, 1500, usageData.model);
      if (costData) {
        costText = `약 ₩${costData.krw.toFixed(2)} · 입력 ${costData.tokens.write} / 캐시 ${costData.tokens.read} / 출력 ${costData.tokens.output} / 추론 ${costData.tokens.thoughts}`;
      }
    }

    costInfo.textContent = costText;
    historyCount.textContent = `${transIndex + 1} / ${transHistory.length}`;
    prevBtn.disabled = transIndex === 0;
    nextBtn.disabled = transIndex === transHistory.length - 1;
  }

  function closeResultModal() {
    document.getElementById('trans-result-overlay').style.display = 'none';
    document.getElementById('trans-result-modal').style.display = 'none';
  }

  function renderReplacementSlots() {
    const settingList = document.getElementById('trans-slot-list');
    const modalList = document.getElementById('trans-modal-slot-list');
    if (!settingList || !modalList) return;

    settingList.innerHTML = '';
    modalList.innerHTML = '';

    if (replacementSlots.length === 0) {
      settingList.innerHTML = '<span class="t-slot-empty">저장된 슬롯이 없습니다.</span>';
      modalList.innerHTML = '<span class="t-slot-empty">저장된 치환 슬롯 없음</span>';
      return;
    }

    replacementSlots.forEach((slot, index) => {
      const settingChip = document.createElement('span');
      settingChip.className = 't-slot-chip';
      settingChip.title = `${slot.find} → ${slot.replace}`;
      settingChip.appendChild(document.createTextNode(`${slot.find} → ${slot.replace}`));

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = '✕';
      deleteBtn.title = '삭제';
      deleteBtn.addEventListener('click', () => {
        replacementSlots.splice(index, 1);
        GM_setValue('replacementSlots', replacementSlots);
        renderReplacementSlots();
        showNudge('치환 슬롯을 삭제했습니다.', 'ok');
      });
      settingChip.appendChild(deleteBtn);
      settingList.appendChild(settingChip);

      const modalBtn = document.createElement('button');
      modalBtn.type = 'button';
      modalBtn.className = 't-apply-slot';
      modalBtn.textContent = `${slot.find} → ${slot.replace}`;
      modalBtn.title = '현재 번역 결과에 적용';
      modalBtn.addEventListener('click', () => {
        applyReplacementToResult(slot.find, slot.replace);
      });
      modalList.appendChild(modalBtn);
    });
  }

  function applyReplacementToResult(find, replace) {
    const target = String(find || '');
    const replacement = String(replace || '');
    const resultContent = document.getElementById('trans-result-content');
    if (!resultContent) return 0;

    if (!target) {
      showNudge('찾을 말을 입력해주세요.', 'err');
      return 0;
    }

    const before = resultContent.value;
    const count = countOccurrences(before, target);
    if (count === 0) {
      showNudge(`"${target}"을 찾지 못했습니다.`, 'err');
      return 0;
    }

    resultContent.value = before.split(target).join(replacement);
    if (transIndex >= 0 && transHistory[transIndex] !== undefined) {
      transHistory[transIndex] = resultContent.value;
    }

    showNudge(`${count}곳을 교체했습니다: ${target} → ${replacement}`, 'ok');
    return count;
  }

  function countOccurrences(text, needle) {
    if (!needle) return 0;
    return text.split(needle).length - 1;
  }

  function showNudge(message, type = 'info', persist = false) {
    const nudge = document.getElementById('trans-nudge');
    if (!nudge) return;

    clearTimeout(nudgeTimer);
    nudge.textContent = message;
    nudge.className = `${type} active ${detectSiteTheme() === 'dark' ? 'trans-theme-dark' : 'trans-theme-light'}`;

    if (!persist) {
      nudgeTimer = setTimeout(() => {
        nudge.classList.remove('active');
      }, 3200);
    }
  }

  function formatCostForMessage(usage, model) {
    const c = calculateCost(usage, 1500, model);
    return c ? ` (약 ₩${c.krw.toFixed(2)} 소모)` : '';
  }

  function parsePath() {
    const m = location.pathname.match(/\/stories\/([^/]+)\/episodes\/([^/]+)/);
    return m ? m[2] : null;
  }

  function buildHeaders() {
    const cookies = document.cookie.split(';').map(c => c.trim());
    const token = cookies.find(c => c.startsWith('access_token='))?.slice('access_token='.length) || '';
    const wrtnId = cookies.find(c => c.startsWith('__w_id='))?.slice('__w_id='.length) || '';
    const headers = {
      'Content-Type': 'application/json',
      platform: 'web',
      'wrtn-locale': 'ko-KR',
    };

    if (token) headers.Authorization = `Bearer ${token}`;
    if (wrtnId) headers['x-wrtn-id'] = wrtnId;
    return headers;
  }

  function maskCodeBlocks(text) {
    return text.replace(CODE_BLOCK_RE, (_, inner) => `${FENCE_OPEN_SUB}${inner}${FENCE_CLOSE_SUB}`);
  }

  function unmaskCodeBlocks(text) {
    return text.split(FENCE_OPEN_SUB).join('```').split(FENCE_CLOSE_SUB).join('```');
  }

  function stripOuterFence(text) {
    return text.replace(/^```[^\n]*\n([\s\S]*?)\n```\s*$/m, '$1').trim();
  }

  function buildGenerationConfig(modelId) {
    const genConfig = { temperature: 0.7 };

    if (modelId.includes('gemini-3')) {
      delete genConfig.temperature;
      let level = thinkingLevels[modelId] || 'medium';
      if (modelId.includes('pro') && level === 'minimal') level = 'low';
      genConfig.thinkingConfig = { thinkingLevel: level };
    } else if (modelId.includes('gemini-2.5')) {
      let budget = thinkingBudgets[modelId] || 1024;
      if (budget < 128) budget = 128;
      genConfig.thinkingConfig = { thinkingBudget: budget };
    }

    return genConfig;
  }

  function getPrompt() {
    return document.getElementById('trans-custom-prompt').value;
  }

  function callGemini(text, overrideModel = null) {
    return new Promise(async (resolve, reject) => {
      const provider = document.getElementById('trans-api-provider').value;
      const modelId = overrideModel || document.getElementById('trans-model-select').value;
      const finalPrompt = getPrompt();
      const maskedText = maskCodeBlocks(text);
      const generationConfig = buildGenerationConfig(modelId);

      // DeepSeek 통신
      if (provider === 'deepseek') {
        const apiKey = document.getElementById('trans-api-key').value.trim();
        if (!apiKey) {
          reject(new Error('DeepSeek API 키가 설정되지 않았습니다.'));
          return;
        }

        GM_xmlhttpRequest({
          method: 'POST',
          url: 'https://api.deepseek.com/chat/completions',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          data: JSON.stringify({
            model: modelId,
            messages: [
              { role: 'system', content: finalPrompt },
              { role: 'user', content: maskedText }
            ]
          }),
          onload(res) {
            try {
              const data = JSON.parse(res.responseText);
              if (data.error) {
                reject(new Error(data.error.message));
                return;
              }
              const raw = data.choices[0].message.content;
              const usage = data.usage || {};
              const restored = unmaskCodeBlocks(stripOuterFence(raw));
              resolve({
                text: restored,
                usage: { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens },
                model: modelId
              });
            } catch (e) {
              reject(e);
            }
          },
          onerror() {
            reject(new Error('DeepSeek 네트워크 오류가 발생했습니다.'));
          }
        });
        return;
      }

      // Firebase 통신
      if (provider === 'firebase') {
        try {
          const result = await callFirebaseGemini(maskedText, modelId, finalPrompt, generationConfig);
          resolve(result);
        } catch (e) {
          reject(e);
        }
        return;
      }

      // Google 기본 통신
      const apiKey = document.getElementById('trans-api-key').value.trim();
      if (!apiKey) {
        reject(new Error('API 키가 설정되지 않았습니다.'));
        return;
      }

      GM_xmlhttpRequest({
        method: 'POST',
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({
          system_instruction: { parts: [{ text: finalPrompt }] },
          contents: [{ parts: [{ text: maskedText }] }],
          generationConfig,
        }),
        onload(res) {
          try {
            const data = JSON.parse(res.responseText);
            if (data.error) {
              reject(new Error(data.error.message));
              return;
            }

            const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const usage = data.usageMetadata || {};
            const restored = unmaskCodeBlocks(stripOuterFence(raw));
            resolve({ text: restored, usage, model: modelId });
          } catch (e) {
            reject(e);
          }
        },
        onerror() {
          reject(new Error('네트워크 오류가 발생했습니다.'));
        },
      });
    });
  }

  async function callFirebaseGemini(maskedText, modelId, finalPrompt, generationConfig) {
    const configRaw = document.getElementById('trans-firebase-script').value.trim();
    if (!configRaw) {
      throw new Error('설정창에서 Firebase 복사본을 먼저 입력해주세요.');
    }

    const { configObj, fbVersion } = parseFirebaseConfig(configRaw);
    const appUrl = `https://www.gstatic.com/firebasejs/${fbVersion}/firebase-app.js`;
    const majorVersion = parseInt(fbVersion.split('.')[0], 10);
    const aiUrl = majorVersion >= 12
      ? `https://www.gstatic.com/firebasejs/${fbVersion}/firebase-ai.js`
      : `https://www.gstatic.com/firebasejs/${fbVersion}/firebase-vertexai.js`;

    try {
      const { initializeApp, getApps, getApp } = await import(appUrl);
      const app = getOrCreateFirebaseApp({ initializeApp, getApps, getApp }, configObj);

      let generativeModel;
      if (majorVersion >= 12) {
        const {
          HarmBlockThreshold,
          HarmCategory,
          VertexAIBackend,
          getAI,
          getGenerativeModel,
        } = await import(aiUrl);

        const ai = getAI(app, { backend: new VertexAIBackend(FIREBASE_LOCATION) });
        generativeModel = getGenerativeModel(ai, {
          model: modelId,
          safetySettings: buildSafetySettings(HarmCategory, HarmBlockThreshold),
          systemInstruction: { parts: [{ text: finalPrompt }] },
          generationConfig,
        });
      } else {
        const {
          HarmBlockThreshold,
          HarmCategory,
          getVertexAI,
          getGenerativeModel,
        } = await import(aiUrl);

        const vertexAI = getVertexAI(app, { location: FIREBASE_LOCATION });
        generativeModel = getGenerativeModel(vertexAI, {
          model: modelId,
          safetySettings: buildSafetySettings(HarmCategory, HarmBlockThreshold),
          systemInstruction: { parts: [{ text: finalPrompt }] },
          generationConfig,
        });
      }

      const result = await generativeModel.generateContent(maskedText);
      const rawResult = result.response.text();
      const usage = result.response.usageMetadata || {};
      const restored = unmaskCodeBlocks(stripOuterFence(rawResult));
      return { text: restored, usage, model: modelId };
    } catch (e) {
      throw new Error(`Firebase Vertex 통신 실패: ${e.message}`);
    }
  }

  function parseFirebaseConfig(configRaw) {
    let fbVersion = '12.12.0';
    const versionMatch = configRaw.match(/firebasejs\/([0-9.]+)\/firebase-app\.js/);
    if (versionMatch?.[1]) fbVersion = versionMatch[1];

    try {
      const configMatch = configRaw.match(/(?:const|let|var)\s+firebaseConfig\s*=\s*({[\s\S]*?});/);
      if (configMatch?.[1]) {
        return { configObj: new Function(`return (${configMatch[1]});`)(), fbVersion };
      }

      const fallbackMatch = configRaw.match(/({[\s\S]*?apiKey[\s\S]*?appId[\s\S]*?})/);
      if (fallbackMatch?.[1]) {
        return { configObj: new Function(`return (${fallbackMatch[1]});`)(), fbVersion };
      }
    } catch (e) {
      throw new Error('Firebase 코드를 해독하지 못했습니다. 파이어베이스 홈페이지의 코드를 그대로 넣어주세요.');
    }

    throw new Error('Firebase 코드를 해독하지 못했습니다. 파이어베이스 홈페이지의 코드를 그대로 넣어주세요.');
  }

  function getOrCreateFirebaseApp(firebaseAppModule, configObj) {
    const { initializeApp, getApps, getApp } = firebaseAppModule;
    const existing = getApps().find(app => app.name === FIREBASE_APP_NAME);
    if (existing) return getApp(FIREBASE_APP_NAME);
    return initializeApp(configObj, FIREBASE_APP_NAME);
  }

  function buildSafetySettings(HarmCategory, HarmBlockThreshold) {
    return [
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.OFF },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.OFF },
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.OFF },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.OFF },
    ];
  }

  async function fetchLatestBotMessage(chatId) {
    const res = await fetch(`${API_BASE}/v3/chats/${chatId}/messages?limit=20`, {
      headers: buildHeaders(),
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`메시지 조회 실패 (${res.status})`);

    const json = await res.json();
    const msgs = (json.data ?? json).messages ?? [];
    const bot = msgs.find(m => m.role === 'assistant');
    if (!bot) throw new Error('최신 AI 메시지를 찾을 수 없습니다.');
    return { id: bot._id ?? bot.id, content: bot.content ?? '', allMsgs: msgs };
  }

  async function patchMessage(chatId, messageId, content) {
    const res = await fetch(`${API_BASE}/v3/chats/${chatId}/messages/${messageId}`, {
      method: 'PATCH',
      headers: buildHeaders(),
      credentials: 'include',
      body: JSON.stringify({ message: content }),
    });
    if (!res.ok) throw new Error(`메시지 수정 실패 (${res.status})`);
    return res.json();
  }

  function findMessageById(messages, messageId) {
    if (!messageId) return null;
    return messages.find(m => String(m._id || m.id || '') === String(messageId)) || null;
  }

  function normalizeForMessageMatch(text) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, block => block.replace(/```/g, ''))
      .replace(/[#*_`~>\-[\](){}.!?,:;"']/g, '')
      .replace(/\s+/g, '')
      .trim();
  }

  function resolveTargetBotMessage(messages, fallbackMsgId, visibleText) {
    const byId = findMessageById(messages, fallbackMsgId);
    if (byId?.role === 'assistant') return byId;

    const visibleNorm = normalizeForMessageMatch(visibleText);
    if (visibleNorm) {
      const byRenderedText = messages.find(m => {
        if (m.role !== 'assistant' || !m.content) return false;
        const contentNorm = normalizeForMessageMatch(m.content);
        return contentNorm.includes(visibleNorm) || visibleNorm.includes(contentNorm);
      });
      if (byRenderedText) return byRenderedText;
    }

    return messages.find(m => m.role === 'assistant') || null;
  }

  function getMessageContent(message) {
    return message?.content ?? message?.message ?? message?.text ?? '';
  }

  function injectSidebar() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.textContent.includes('키보드 단축키')) continue;

      const container = node.parentElement?.closest('.px-2\\.5');
      if (container && !document.getElementById('trans-menu-btn')) {
        const btn = document.createElement('div');
        btn.id = 'trans-menu-btn';
        btn.className = 'px-2.5 h-4 box-content py-[18px]';
        btn.style.cursor = 'pointer';
        btn.innerHTML = '<span class="flex space-x-2 items-center"><span style="font-size:16px;">✨</span><span style="font-size:14px;">초월 번역 설정</span></span>';
        btn.onclick = () => {
          document.getElementById('trans-setting-panel').style.display = 'block';
          syncTranslatorTheme();
        };
        container.parentNode.insertBefore(btn, container.nextSibling);
      }
    }
  }

  async function executeBubbleTranslation(textToTranslate, fallbackMsgId) {
    const chatId = parsePath();
    if (!chatId) {
      alert('채팅방 페이지에서만 사용 가능합니다.');
      return;
    }

    const instantApply = document.getElementById('trans-instant-apply')?.checked || GM_getValue('instantApply', false);
    if (instantApply) {
      await executeInstantBubbleTranslation(textToTranslate, fallbackMsgId, chatId);
      return;
    }

    document.getElementById('trans-modal-model').value = document.getElementById('trans-model-select').value;
    showNudge('번역 중...', 'info', true);

    try {
      activeChatId = chatId;

      const { allMsgs, id: latestMsgId } = await fetchLatestBotMessage(chatId);
      const targetMsg = resolveTargetBotMessage(allMsgs, fallbackMsgId, textToTranslate);
      activeMsgId = targetMsg ? (targetMsg._id || targetMsg.id) : (fallbackMsgId || latestMsgId);
      activeOriginalText = getMessageContent(targetMsg) || textToTranslate;
      activeIsFullMode = true;

      const resultObj = await callGemini(activeOriginalText);
      transHistory = [resultObj.text];
      transUsageHistory = [{ usage: resultObj.usage, model: resultObj.model }];
      transIndex = 0;

      document.getElementById('trans-result-overlay').style.display = 'block';
      document.getElementById('trans-result-modal').style.display = 'flex';
      renderModalState();
      syncTranslatorTheme();
      showNudge('번역 완료. 팝업에서 확인하세요.', 'ok');
    } catch (err) {
      showNudge(`번역 실패: ${err.message}`, 'err');
      alert(`번역 실패: ${err.message}`);
    }
  }

  async function executeInstantBubbleTranslation(textToTranslate, fallbackMsgId, chatId) {
    showNudge('번역 중... 완료되면 바로 교체합니다.', 'info', true);

    try {
      const { allMsgs, id: latestMsgId, content: latestContent } = await fetchLatestBotMessage(chatId);
      const targetMsg = resolveTargetBotMessage(allMsgs, fallbackMsgId, textToTranslate);
      const targetMsgId = targetMsg ? (targetMsg._id || targetMsg.id) : (fallbackMsgId || latestMsgId);
      const originalContent = getMessageContent(targetMsg) || latestContent || textToTranslate;
      if (!originalContent.trim()) throw new Error('번역할 내용이 없습니다.');

      const resultObj = await callGemini(originalContent);
      const newContent = resultObj.text;

      await patchMessage(chatId, targetMsgId, newContent);
      showNudge(`번역 교체 완료! 새로고침 하세요.${formatCostForMessage(resultObj.usage, resultObj.model)}`, 'ok');
    } catch (err) {
      showNudge(`번역 실패: ${err.message}`, 'err');
      alert(`번역 실패: ${err.message}`);
    }
  }

  function injectBubbleButtons() {
    const groups = document.querySelectorAll('.flex.flex-row.gap-2.items-center:not(.trans-injected)');
    groups.forEach(group => {
      if (!group.querySelector('button[aria-label="메시지 옵션"]')) return;

      const btn = document.createElement('button');
      btn.className = 'trans-bubble-btn relative inline-flex items-center justify-center overflow-hidden rounded-full transition-colors size-7 bg-transparent hover:bg-accent';
      btn.type = 'button';
      btn.innerHTML = '✨';
      btn.style.marginRight = '4px';
      btn.style.fontSize = '14px';
      btn.title = '초월 번역';
      btn.onclick = (e) => {
        e.stopPropagation();
        const messageBlock = e.currentTarget.closest('.w-full[data-message-group-id]');
        let text = '';
        let msgId = '';

        if (messageBlock) {
          const md = messageBlock.querySelector('.wrtn-markdown');
          if (md) text = md.innerText;
          msgId = messageBlock.getAttribute('data-message-group-id') || '';
        }

        if (!text) {
          alert('텍스트를 찾을 수 없습니다.');
          return;
        }

        executeBubbleTranslation(text, msgId);
      };
      group.insertBefore(btn, group.firstChild);
      group.classList.add('trans-injected');
    });
  }

  function detectSiteTheme() {
    const htmlAndBody = `${document.documentElement.className} ${document.body.className} ${document.documentElement.dataset.theme || ''} ${document.body.dataset.theme || ''}`.toLowerCase();
    if (/\b(light|theme-light)\b/.test(htmlAndBody)) return 'light';
    if (/\b(dark|theme-dark)\b/.test(htmlAndBody)) return 'dark';

    const bg = getComputedStyle(document.body).backgroundColor || getComputedStyle(document.documentElement).backgroundColor;
    const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      const r = Number(match[1]);
      const g = Number(match[2]);
      const b = Number(match[3]);
      const luminance = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
      return luminance < 128 ? 'dark' : 'light';
    }

    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function syncTranslatorTheme() {
    const theme = detectSiteTheme();
    const targets = [
      document.getElementById('trans-setting-panel'),
      document.getElementById('trans-result-modal'),
      document.getElementById('trans-result-overlay'),
      document.getElementById('trans-nudge'),
    ].filter(Boolean);

    targets.forEach(el => {
      el.classList.toggle('trans-theme-dark', theme === 'dark');
      el.classList.toggle('trans-theme-light', theme !== 'dark');
    });
  }

  addStyles();
  createUI();

  const observer = new MutationObserver(() => {
    injectSidebar();
    injectBubbleButtons();
    syncTranslatorTheme();
  });

  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-theme'] });
  injectSidebar();
  injectBubbleButtons();
})();
