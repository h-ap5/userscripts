<a id="top"></a>

# 크랙 확장 프로그램 모음

나와 제미나이, 코덱스, 클로드가 함께한 편의성 확장 프로그램들

---

## 목차
클릭시 해당 섹션으로 이동합니다.

- [크랙 요약 메모리 편집 & AI 자동 정리](#automemory)
- [초월 번역기](#autotrans)
- [(구) 미디어 이미지 추가 편의성](#media)
- [일일 크래커 가드](#guard)
- [크랙 버블 북마크](#bookmark)

---

<a id="automemory"></a>

## 크랙 요약 메모리 편집 & AI 자동 정리

<a href="https://github.com/h-ap5/userscripts/raw/refs/heads/main/scripts/automemory.user.js"><img src="https://github.com/h-ap5/userscripts/blob/main/icons/1d%20(1).png?raw=true" width="20" alt="설치"></a>
<a href="https://github.com/h-ap5/userscripts/raw/refs/heads/main/scripts/automemory.user.js"><img src="https://img.shields.io/badge/INSTALL-007acc?style=for-the-badge&logo=tampermonkey&logoColor=white" alt="설치"></a>
<a href="https://github.com/h-ap5/userscripts/blob/main/PatchNotes/automemory.md"><img src="https://img.shields.io/badge/%F0%9F%94%A7-PATCH_NOTES-e9a01e?style=for-the-badge" alt="패치노트"></a>

**기능 및 사용 방법**

> 채팅 로그를 AI로 요약해 장기기억 카드에 추가하고, 새 대화를 채팅방별로 자동 누적 정리합니다. 카드가 많아지면 최근 구간 병합과 전체 압축도 관리합니다.

### 도구 열기

- 채팅방 상단의 **요약** 버튼 또는 사이드바의 **AI 요약·메모리** 메뉴를 누릅니다.
- 설정창에서 **상단 요약 버튼 표시**를 끄면 사이드바 메뉴만 남길 수 있습니다.
- 소설형·채팅형, 모바일, 순정 UI와 UImax·Mobile Utility 환경을 지원합니다.

### 직접 요약

1. **Google·Vertex JSON·DeepSeek·OpenAI·Firebase** 중 사용할 API와 모델을 선택합니다.
2. **턴 수·요약 스타일·추론 단계**를 정합니다.
3. 선택한 연결 방식에 맞춰 API Key, Firebase Script 또는 Vertex 서비스 계정 JSON을 입력합니다.
4. **요약 생성**을 누른 뒤 결과 카드의 제목과 내용을 확인하거나 직접 수정합니다.
5. **추가하기**를 누르면 각 `[제목] + 내용` 묶음이 장기기억에 저장됩니다.

> [!NOTE]
> 직접 요약의 **턴 수**는 채팅 버블 개수를 기준으로 계산합니다.  
> 사용자 메시지 1개 = 1턴  
> LLM 응답 1개 = 1턴  
> 사용자 1 + LLM 1 = 총 2턴  
>
> 따라서 일반적인 대화 30턴을 불러오려면 확장프로그램에서는 60턴으로 설정합니다. `0`을 입력하면 불러올 수 있는 전체 채팅 내역을 대상으로 요약합니다.

<p align="center">
  <img width="980" height="860" alt="image" src="https://github.com/user-attachments/assets/0d059e71-e82e-4c85-b0d3-2cb29f24e524" />
</p>

### 자동 장기기억 정리

1. 위쪽에서 자동 정리에 사용할 **API·모델·추론 단계·요약 스타일**과 인증 정보를 먼저 저장합니다.
2. **자동 장기기억 정리**를 펼치고 **자동 정리 사용**을 켭니다.
3. 사용자가 만든 `[추가]` 카드를 건드리지 않게 하려면 **[추가] 카드 보호**를 켭니다.
4. 아래 설정을 조정한 뒤 **설정 저장**을 누릅니다. 설정은 채팅방별로 따로 보관됩니다.
5. 처음 켜면 현재 완료된 대화를 기준점으로 저장하고, 이후 새로 완성된 대화턴부터 주기적으로 처리합니다. 바로 확인하려면 **지금 실행**을 누릅니다.

> [!IMPORTANT]
> 자동 정리의 **대화턴 1개**는 `사용자 메시지 1회 + AI 답변 1회` 한 세트입니다. 직접 요약의 버블 기준 `턴 수`와 계산 방식이 다릅니다.

| 자동 설정 | 기본값 | 기능 |
|---|---:|---|
| **실행 주기 (대화턴)** | 10 | 새로 완료된 대화가 이만큼 쌓이면 자동 정리 실행 |
| **한 번에 읽을 대화턴** | 10 | 한 번의 AI 호출에서 처리할 최대 대화 분량 |
| **최근 제외 (대화턴)** | 1 | 경계가 잘리지 않도록 최신 대화를 다음 실행까지 보류 |
| **참고 장기기억** | 5 | 문맥 참고용으로 AI에 함께 전달할 최근 장기기억 수. `0`이면 추가 참고 없음 |
| **중간 병합 주기 (처리턴)** | 10 | 최근 누적 구간을 2차 압축 프롬프트로 병합. `0`이면 끔 |
| **전체 장기기억 유지 상한** | 20 | 전체 압축을 시작할 카드 수 기준. 보호된 `[추가]` 카드도 개수에 포함 |
| **압축 후 전체 카드 목표** | 16 | 전체 압축 뒤 남길 카드 수 목표 |
| **[추가] 카드 보호** | 켬 | 사용자가 만든 `[추가]` 카드를 자동 수정·삭제하지 않음 |

#### 자동 정리 작동 방식

- 평소에는 오래된 독립 장기기억을 유지하고, 새 로그가 마지막 사건의 직접 후속일 때만 마지막 카드를 갱신합니다.
- 독립된 사건은 비어 있는 assistant 장기기억 슬롯에 새 카드로 누적합니다. 새 슬롯이 없으면 로그를 억지로 합치거나 버리지 않고 보류합니다.
- **중간 병합**은 최근 누적 구간에만 적용하고, 전체 카드 수가 **전체 장기기억 유지 상한**을 넘었을 때만 **전체 압축**을 실행합니다.
- `[추가]` 카드 보호를 켜면 해당 카드는 수정·삭제하지 않습니다. 자동 정리는 assistant 슬롯만 치환·삭제하며 새 `[추가]` 카드를 만들지 않습니다.
- 저장 계획을 먼저 기록한 뒤 수정·검증·삭제하므로, 새로고침이나 API 오류로 중단돼도 미완료 작업부터 이어서 처리합니다.
- 여러 탭에서 동시에 저장하지 않도록 잠금을 사용합니다. 일반 오류는 1분·5분 뒤 재시도하며, 3회 연속 발생하면 자동 처리를 잠시 멈추고 실제 오류 원인을 표시합니다. 설정을 저장하거나 **지금 실행**을 누르면 재개합니다.
- **기준점 초기화**는 자동 처리 기준점·관리 이력·자동 AI 비용 기록만 초기화하며, 이미 저장된 장기기억 카드는 삭제하지 않습니다.

> [!NOTE]
> 아래의 수동 **2차 압축**은 원본 장기기억을 유지한 채 새 결과를 추가합니다. 자동 정리의 **중간 병합·전체 압축**은 자동 관리 가능한 기존 assistant 슬롯을 실제로 치환·삭제합니다.

### 주요 도구

| 버튼 | 기능 |
|---|---|
| **요약 생성** | 최근 채팅을 불러와 선택한 프롬프트로 장기기억 요약 생성 |
| **자동 장기기억 정리** | 새 대화를 채팅방별로 누적 정리하고 필요할 때 중간 병합·전체 압축 |
| **2차 압축** | 기존 장기기억 여러 개를 선택해 더 적은 검색형 기억으로 재정리 |
| **장기기억 편집** | 저장된 기억을 검색하고 수정·삭제·일괄 원복 |
| **TXT / JSON / Markdown** | 현재 결과 또는 저장된 장기기억 전체 내보내기 |
| **프롬프트 편집** | 1차 요약·자동 정리·2차 압축 프롬프트를 종류별 슬롯에 저장하고 전환 |
| **사용량 표시** | 호출 수, 입력·출력·추론 토큰과 유료 API 표준 단가 기준 예상 비용 확인 |

#### 장기기억 2차 압축

압축할 기억을 여러 개 고른 뒤 **압축 생성**을 누릅니다. 원본 기억은 유지되며, 생성된 압축 결과를 확인하고 새 장기기억으로 추가할 수 있습니다.

<p align="center">
  <img width="980" height="860" alt="image" src="https://github.com/user-attachments/assets/0373d612-7787-480d-95cb-80f5de616aea" />
</p>

#### 장기기억 일괄 편집

제목이나 내용으로 검색한 뒤 개별 또는 여러 항목을 선택해 수정·삭제할 수 있습니다. 실제 반영은 아래의 **변경사항 저장**을 눌렀을 때 실행됩니다.

<p align="center">
  <img width="980" height="860" alt="image" src="https://github.com/user-attachments/assets/9e56dac5-4ff6-49ae-927c-7a4a0e47305b" />
</p>

### 알아두기

- 제목은 **20자**, 내용은 **300자**를 넘으면 바로 저장할 수 없습니다.
- 직접 요약 턴 수와 자동 정리의 숫자 설정에는 고정 최댓값이 없습니다. 실행 주기·한 번에 읽기·유지 상한·압축 후 목표는 `1` 이상, 최근 제외·참고 장기기억·중간 병합은 `0` 이상인 정수여야 하며, 압축 후 목표는 유지 상한 이하여야 합니다.
- 큰 값을 입력할수록 불러오는 대화와 AI 입력량·처리 시간·비용이 늘어날 수 있습니다.
- 자동 정리 설정과 진행 상태는 채팅방별로 보관됩니다. 일반 API Key·Firebase 설정 등은 현재 브라우저의 로컬 저장소에 보관됩니다.
- 자동 정리는 서버에서 계속 도는 예약 작업이 아니라 유저스크립트가 실행 중인 채팅방에서 작동합니다. 다른 곳에 있다가 채팅방으로 돌아오면 저장된 기준점 이후의 완료된 대화를 확인하며, 아직 생성 중인 AI 답변은 처리하지 않습니다.
- Vertex JSON은 **세션 입력**과 **JSON 저장/교체**를 지원합니다. 세션 입력은 창을 완전히 닫으면 폐기되고, 저장본은 userscript 전용 GM 저장소에 보관되며 원문을 설정 화면에 다시 표시하지 않습니다.
- 요약과 자동 정리를 실행하면 선택한 API 제공자에게 대상 채팅과 필요한 참고 장기기억이 전송됩니다. 민감한 대화는 사용 전 확인해 주세요.
- 자동 정리의 유지 상한은 플랫폼의 `[추가]` 카드 100개 제한과 별개의 기준입니다.
- Google과 Vertex JSON에서는 Gemini 3.8 Flash를 직접 요약·자동 정리·2차 압축에 사용할 수 있습니다.
- 모바일과 다크 테마를 지원하며, UImax와 Mobile Utility의 와이드뷰·상단바 숨김 환경도 고려했습니다.

<p align="right"><a href="#top">⬆ 목차로 돌아가기</a></p>

---

<a id="autotrans"></a>

## 초월 번역기

<a href="https://github.com/h-ap5/userscripts/raw/refs/heads/main/scripts/autotrans.user.js"><img src="https://github.com/h-ap5/userscripts/blob/main/icons/1d%20(1).png?raw=true" width="20" alt="설치"></a>
<a href="https://github.com/h-ap5/userscripts/raw/refs/heads/main/scripts/autotrans.user.js"><img src="https://img.shields.io/badge/INSTALL-007acc?style=for-the-badge&logo=tampermonkey&logoColor=white" alt="설치"></a>
<a href="https://github.com/h-ap5/userscripts/blob/main/PatchNotes/autotrans.md"><img src="https://img.shields.io/badge/%F0%9F%94%A7-PATCH_NOTES-e9a01e?style=for-the-badge" alt="패치노트"></a>

**기능 및 사용 방법**

> 메시지를 자동으로 감지해 번역하고, 기존 메시지를 번역본으로 교체합니다.

<img width="247" height="238" alt="image" src="https://github.com/user-attachments/assets/b2bdeb83-c379-4802-a96f-c78dc851d229" />

- 크랙 채팅방의 **오른쪽 사이드바**에서 초월 번역 설정을 열 수 있습니다.
- 번역할 AI 메시지 아래의 번역 아이콘을 누르면 번역 결과를 확인하고 교체할 수 있습니다.

### 즉시 교체

<img width="311" height="95" alt="image" src="https://github.com/user-attachments/assets/89a998a6-3c92-41aa-88a2-42f0c7e59b95" />

- 해당 옵션을 켜면 채팅의 번역 아이콘을 눌렀을 때 결과 팝업을 띄우지 않고 즉시 번역·교체합니다.

### 유의할 점

- DeepSeek 모델 사용 시 대화 로그가 DeepSeek API로 전송될 수 있습니다.
- 민감한 대화는 사용하려는 API 제공자의 개인정보 처리 방침을 확인한 뒤 이용해 주세요.

<p align="right"><a href="#top">⬆ 목차로 돌아가기</a></p>

---

<a id="media"></a>

## (구) 미디어 이미지 추가 편의성

<a href="https://github.com/h-ap5/userscripts/raw/refs/heads/main/scripts/media.user.js"><img src="https://github.com/h-ap5/userscripts/blob/main/icons/1d%20(1).png?raw=true" width="20" alt="설치"></a>
<a href="https://github.com/h-ap5/userscripts/raw/refs/heads/main/scripts/media.user.js"><img src="https://img.shields.io/badge/INSTALL-007acc?style=for-the-badge&logo=tampermonkey&logoColor=white" alt="설치"></a>
<a href="https://github.com/h-ap5/userscripts/blob/main/PatchNotes/media.md"><img src="https://img.shields.io/badge/%F0%9F%94%A7-PATCH_NOTES-e9a01e?style=for-the-badge" alt="패치노트"></a>

**기능 및 사용 방법**

> 구 제작 미디어 환경에서 이미지를 간편하게 삽입하고, 불필요한 힌트창을 켜거나 끌 수 있습니다.

<p align="right"><a href="#top">⬆ 목차로 돌아가기</a></p>

---

<a id="guard"></a>

## 일일 크래커 가드

<a href="https://github.com/h-ap5/userscripts/raw/refs/heads/main/scripts/guard.user.js"><img src="https://github.com/h-ap5/userscripts/blob/main/icons/1d%20(1).png?raw=true" width="20" alt="설치"></a>
<a href="https://github.com/h-ap5/userscripts/raw/refs/heads/main/scripts/guard.user.js"><img src="https://img.shields.io/badge/INSTALL-007acc?style=for-the-badge&logo=tampermonkey&logoColor=white" alt="설치"></a>
<a href="https://github.com/h-ap5/userscripts/blob/main/PatchNotes/guard.md"><img src="https://img.shields.io/badge/%F0%9F%94%A7-PATCH_NOTES-e9a01e?style=for-the-badge" alt="패치노트"></a>

**기능 및 사용 방법**

> 오늘 사용한 크래커를 자동 합산하고, 설정한 일일 목표의 허용 범위에 도달하면 메시지 전송과 재생성을 차단합니다.

### 기본 사용법

1. 채팅 입력창 위의 **크래커 가드** 상태 행을 누릅니다.
2. 하루에 맞추고 싶은 **일일 목표**를 입력합니다.
3. 불규칙한 크래커 소모량을 고려한 **허용 오차(±)**를 입력합니다.
4. 필요하면 **재생성도 차단**을 활성화합니다.
5. **설정 저장**을 누르면 현재 사용량을 기준으로 자동 감시합니다.

> **예시:** 일일 목표가 `1,000개`, 허용 오차가 `±200개`라면 정지 구간은 `800~1,200개`입니다. 최근 1회 소모량을 참고하여 목표에 더 가까운 지점에서 멈춥니다.

### 주요 기능

| 기능 | 설명 |
|---|---|
| **오늘 사용량 자동 합산** | 크랙의 크래커 사용 내역을 기준으로 한국 시간 오늘 0시부터 합산 |
| **목표 허용 구간** | 일일 목표와 허용 오차를 이용해 정지 구간 계산 |
| **전송 차단** | 전송 버튼과 Enter 키를 통한 메시지 전송 차단 |
| **재생성 차단** | 리롤·다시 생성으로 추가 소모되는 크래커 차단 |
| **자동 갱신** | 20초마다, 창 복귀 시, 메시지 전송 후 사용량 갱신 |
| **테마 호환** | 입력창에 적용된 라이트·다크·배경 테마를 상태 행에도 반영 |

### 알아두기

- 별도의 API Key는 필요하지 않습니다.
- 설정은 현재 브라우저의 로컬 저장소에 보관됩니다.
- 다른 브라우저나 기기에서 사용한 크래커도 다음 사용 내역 갱신 때 합산됩니다.
- 사용 내역을 아직 확인하지 못했거나 정보가 오래된 경우에는 안전을 위해 전송을 잠시 차단합니다.
- 다른 확장프로그램이 리롤을 별도의 길게 누르기 이벤트로 구현한 경우에는 재생성 차단이 적용되지 않을 수 있습니다.

<p align="right"><a href="#top">⬆ 목차로 돌아가기</a></p>

---

<a id="bookmark"></a>

## 크랙 버블 북마크

<a href="https://github.com/h-ap5/userscripts/raw/refs/heads/main/scripts/bookmark.user.js"><img src="https://github.com/h-ap5/userscripts/blob/main/icons/1d%20(1).png?raw=true" width="20" alt="설치"></a>
<a href="https://github.com/h-ap5/userscripts/raw/refs/heads/main/scripts/bookmark.user.js"><img src="https://img.shields.io/badge/INSTALL-007acc?style=for-the-badge&logo=tampermonkey&logoColor=white" alt="설치"></a>

**기능 및 사용 방법**

> 대화 버블을 리본 책갈피로 저장하고, 목록에서 검색·정리하거나 저장한 원문으로 이동합니다.

### 기본 사용법

1. 저장할 대화 버블 우측 위의 **리본 책갈피**를 누릅니다.
2. 채팅 입력창 우측 위에 걸린 리본을 눌러 현재 채팅방의 북마크 목록을 엽니다.
3. 목록의 제목이나 3줄 미리보기를 누르면 해당 원문으로 이동합니다.
4. 연필 버튼으로 제목을 수정하고, 색상 버튼으로 책갈피마다 다른 색을 지정할 수 있습니다.

### 주요 기능

| 기능 | 설명 |
|---|---|
| **버블별 저장** | 유저 입력과 캐릭터 답변을 채팅방별로 저장 |
| **원문 이동** | 아직 화면에 없는 과거 로그를 불러오며 저장한 버블 탐색 |
| **목록 관리** | 제목·본문 검색, 제목 수정, 개별 색상, 삭제 및 되돌리기 |
| **표시 설정** | 유저 입력 버블 책갈피 ON/OFF, 리본 좌우반전, 기본 색상 설정 |
| **화면 호환** | 채팅형·소설형·모바일 화면과 입력창 크기 변화 지원 |

### 알아두기

- 북마크와 설정은 현재 브라우저의 크랙 사이트 로컬 저장소에 보관되며 다른 기기와 자동 동기화되지 않습니다.
- 외부 서버 전송이나 추가 API 호출 없이 동작합니다.
- 오래된 북마크는 크랙이 과거 대화를 불러오는 동안 시간이 걸릴 수 있습니다.
- 원문이 삭제되거나 다른 답변으로 바뀌었다면 저장한 미리보기는 남아 있어도 원문 이동이 완료되지 않을 수 있습니다.
- CSP 테마, 입력창 대시보드, 모바일 유틸, 라디오존데, 일일 크래커 가드와 함께 사용할 수 있도록 별도 오버레이에 표시됩니다.

<p align="right"><a href="#top">⬆ 목차로 돌아가기</a></p>
