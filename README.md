# 크랙 확장 프로그램 모음
나와 제미나이, 코덱스, 클로드가 함께한 편의성 확장 프로그램들
***
## 요약 메모리 자동 생성기<a href="https://github.com/h-ap5/userscripts/raw/refs/heads/main/scripts/automemory.user.js"><img src="https://github.com/h-ap5/userscripts/blob/main/icons/1d%20(1).png?raw=true" width="20" alt="설치"></a> <a href="https://github.com/h-ap5/userscripts/raw/refs/heads/main/scripts/automemory.user.js"><img src="https://img.shields.io/badge/INSTALL-007acc?style=for-the-badge&logo=tampermonkey&logoColor=white" alt="설치"></a> <a href="https://github.com/h-ap5/userscripts/blob/main/PatchNotes/automemory.md"><img src="https://img.shields.io/badge/%F0%9F%94%A7-PATCH_NOTES-e9a01e?style=for-the-badge" alt="패치노트"></a>

**기능 및 사용 방법**
> 크랙 내부에서 장기기억용 요약 메모리 생성 및 자동 추가

### 기본 사용법

1. 크랙 채팅방 오른쪽 위의 **요약** 버튼을 누릅니다.
2. 사용할 **API·모델·턴 수·요약 스타일·추론 단계**를 선택합니다.
3. API Key 또는 Firebase Script를 입력합니다. 입력값은 브라우저에 자동 저장됩니다.
4. **요약 생성**을 누른 뒤 결과를 확인하거나 직접 수정합니다.
5. **추가하기**를 누르면 각 `[제목] + 내용` 묶음이 장기기억에 저장됩니다.

<p align="center">
  <img width="980" height="860" alt="image" src="https://github.com/user-attachments/assets/0d059e71-e82e-4c85-b0d3-2cb29f24e524" />
</p>

> **팁:** 턴 수를 `0`으로 입력하면 불러올 수 있는 전체 채팅 내역을 대상으로 요약합니다.

### 주요 도구

| 버튼 | 기능 |
|---|---|
| **요약 생성** | 최근 채팅을 불러와 선택한 프롬프트로 장기기억 요약 생성 |
| **2차 압축** | 기존 장기기억 여러 개를 선택해 더 적은 검색형 기억으로 재정리 |
| **장기기억 편집** | 저장된 기억을 검색하고 수정·삭제·일괄 원복 |
| **TXT / JSON / Markdown** | 현재 결과 또는 저장된 장기기억 전체 내보내기 |
| **프롬프트 편집** | 1차 요약·2차 압축 프롬프트를 슬롯별로 저장하고 전환 |

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
- API Key와 설정은 현재 브라우저의 로컬 저장소에 보관됩니다.
- 요약 생성 시 선택한 API 제공자에게 불러온 채팅 내용이 전송됩니다. 민감한 대화는 사용 전 확인해주세요.
- 모바일과 다크 테마를 지원합니다.

## 초월 번역기<a href="https://github.com/h-ap5/userscripts/raw/refs/heads/main/scripts/media.user.js"><img src="https://github.com/h-ap5/userscripts/blob/main/icons/1d%20(1).png?raw=true" width="20" alt="설치"></a> <a href="https://github.com/h-ap5/userscripts/raw/refs/heads/main/scripts/autotrans.user.js"><img src="https://img.shields.io/badge/INSTALL-007acc?style=for-the-badge&logo=tampermonkey&logoColor=white" alt="설치"></a> <a href="https://github.com/h-ap5/userscripts/blob/main/PatchNotes/autotrans.md"><img src="https://img.shields.io/badge/%F0%9F%94%A7-PATCH_NOTES-e9a01e?style=for-the-badge" alt="패치노트"></a>

**기능 및 사용 방법**
> 메시지를 자동 감지·번역·수정 삽입

<img width="247" height="238" alt="image" src="https://github.com/user-attachments/assets/b2bdeb83-c379-4802-a96f-c78dc851d229" />

- **채팅창 내 사이드바**에 설정창이 있습니다.

**유의할 점**
- 딥시크 모델 사용시, 로그 정보가 중국에 노출될 수 있습니다.

<img width="311" height="95" alt="image" src="https://github.com/user-attachments/assets/89a998a6-3c92-41aa-88a2-42f0c7e59b95" />

- 해당 옵션을 킬 시 채팅에서 '🅰️' 아이콘을 누를시, 팝업이 뜨지 않고 즉시 번역->교체 합니다.




## (구)미디어 이미지 추가 편의성 <a href="https://github.com/h-ap5/userscripts/raw/refs/heads/main/scripts/media.user.js"><img src="https://github.com/h-ap5/userscripts/blob/main/icons/1d%20(1).png?raw=true" width="20" alt="설치"></a> <a href="https://github.com/h-ap5/userscripts/raw/refs/heads/main/scripts/media.user.js"><img src="https://img.shields.io/badge/INSTALL-007acc?style=for-the-badge&logo=tampermonkey&logoColor=white" alt="설치"></a> <a href="https://github.com/h-ap5/userscripts/blob/main/PatchNotes/media.md"><img src="https://img.shields.io/badge/%F0%9F%94%A7-PATCH_NOTES-e9a01e?style=for-the-badge" alt="패치노트"></a>

**기능 및 사용 방법**
> 구 제작 미디어 환경에서 이미지를 간단 삽입·불필요한 힌트창 ON/OFF
