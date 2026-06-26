# PayNowBiz Tracker

Plain HTML, CSS, JavaScript로 만든 모바일 우선 선불 잔액 트래커입니다. 데이터 저장소는 Supabase Database이며 로그인은 Supabase Auth Google OAuth를 사용합니다.

## 실행

1. `supabase.config.js`에서 `YOUR_SUPABASE_URL`, `YOUR_SUPABASE_PUBLISHABLE_KEY`를 Supabase 프로젝트 값으로 바꿉니다.
2. 정적 서버에서 프로젝트를 엽니다. OAuth 리디렉션 때문에 `file://` 직접 열기보다 로컬 서버 사용을 권장합니다.
3. Supabase 설정과 Google OAuth 설정은 `SETUP.md` 순서대로 진행합니다.

## 보안 메모

- Supabase publishable key 또는 legacy anon key는 브라우저 클라이언트에서 사용할 수 있습니다.
- Supabase service-role key와 Google client secret은 절대 프론트엔드 파일에 넣지 않습니다.
- 실제 데이터 보안은 `supabase/migrations/002_rls_policies.sql`의 RLS 정책이 켜져 있어야 보장됩니다.

## 주요 동작

- Google 로그인 후 워크스페이스 멤버십이 있는 계정만 공유 데이터를 볼 수 있습니다.
- `admin`과 `member`는 같은 워크스페이스의 카드, 선결제, 거래 데이터를 공유합니다.
- 남은 금액은 `승인금액 - 활성 거래 합계`로 계산됩니다.
- 완료 상태는 저장하지 않고 남은 금액이 0원 이하인지로 계산합니다.
- 메인 화면은 사용 중인 잔액과 최근 12개월 안에 활동이 있었던 완료 잔액만 불러옵니다.
- 오래된 완료 잔액은 `이전 기록`에서 승인일 기준 연도별로 열람합니다.
- 승인번호 검색은 앞자리 0을 보존한 텍스트 검색으로 사용 중, 최근 완료, 이전 완료 기록을 찾습니다.
- 실수로 같은 선결제를 다시 입력하지 않도록 최근 12개월 안에 같은 승인번호가 있으면 새 선결제 등록을 막습니다.
- `last_activity_at`은 거래 추가/취소/복구, 선결제 취소/복구처럼 잔액이나 상태가 바뀌는 작업 때 갱신됩니다.
- 거래는 영구 삭제하지 않고 `취소`와 `복구`만 제공합니다.
- 잘못 만든 선결제는 `cancelled`로 소프트 취소되고 관리자 화면에서 복구할 수 있습니다.
- 등록 카드 수정 후에도 과거 선결제는 저장 당시 카드 스냅샷을 유지합니다.
- 등록되지 않은 카드는 해당 선결제에만 저장되고 `cards` 테이블에는 추가되지 않습니다.

## 역할

- `member`: 선결제 생성, 사용 거래 추가, 거래 취소/복구, 선결제 소프트 취소, 거래 내역 조회
- `admin`: member 권한 전체, 카드 추가/수정/비활성화/재활성화, 취소 선결제 복구, JSON/CSV 백업

## 파일

- `index.html`: 로그인, 앱 화면, 관리자 모달 구조
- `styles.css`: 모바일 우선 스타일
- `app.js`: 렌더링, 입력 검증, 역할별 UI 제어
- `supabase.config.js`: 브라우저용 Supabase URL/key 설정
- `supabaseClient.js`: Supabase 클라이언트 생성과 OAuth 리디렉션 URL 계산
- `supabaseService.js`: 인증, 멤버십, 공유 데이터 조회와 변경 함수
- `supabase/migrations/001_schema.sql`: 테이블, 제약조건, 인덱스, updated_at 트리거
- `supabase/migrations/002_rls_policies.sql`: RLS 정책과 멤버 업데이트 보호 트리거
- `supabase/migrations/003_archive_search.sql`: `last_activity_at`, archive/search RPC, activity triggers, archive/search indexes
- `supabase/bootstrap_two_users.sql`: J 관리자 계정과 Mother 멤버 계정 등록용 SQL
- `SETUP.md`: Supabase와 Google Cloud 수동 설정 절차
