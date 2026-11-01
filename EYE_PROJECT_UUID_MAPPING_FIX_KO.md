# UXDS 프로젝트 ID 매핑 수정 (2026-10-19)

## 확인된 실제 DB 구조
- `projects.id`: `uuid` (내부 PK)
- `projects.public_id`: `text` (확장 프로그램에 입력하는 `prj_...`)
- `mouse_tracking_events.project_id`: `uuid`
- `uxds_eye_events.project_id`: `text`, 현재 사용자가 확인한 시점에는 0건
- `gaze_tracking_events`: 기존 UXDS 전용 테이블; 이 패치는 자동으로 이 테이블에 쓰지 않음

## 실제 오류와 수정
기존 `ingest-eye-events`는 `projects.id = 'prj_...'`로 UUID 필드를 비교했습니다.
수정 후 `projects.public_id = 'prj_...'`로 조회하고, 실제 행의 `projects.id` UUID를
`uxds_eye_events.project_id` TEXT 열에 문자열로 저장합니다. 이로써 마우스 데이터의
`project_id::text`와 같아지고 `session_id`도 기존 통합 구조를 유지합니다.

## 적용
1. Supabase 프로젝트 선택/확인. 기존 DB 테이블 변경 없음.
2. `npx supabase login`
3. `npx supabase functions deploy ingest-eye-events --project-ref <실제 프로젝트 ref>`
4. 새 시선 수집 또는 기존 outbox 재전송 결과 확인.
5. SQL: `select project_id, session_id, count(*) from public.uxds_eye_events group by 1,2;`

## 주의
- `verify_jwt = false`: public_id를 아는 사용자가 데이터 위조 전송을 시도할 수 있으므로 외부 배포 전에
  서버 측 참여자 인증/연구 동의/속도 제한을 추가해야 합니다.
- 단순 DB 테이블 존재 여부와 API 저장 성공은 다릅니다. 실제 배포/실행은 사용자가 확인해야 합니다.
- `gaze_tracking_events`(기존 웹 UI에서 읽을 수 있음)는 계속 0건입니다. 웹 UI에서
  `uxds_eye_events`를 사용하려면 별도 조회 API/권한 규칙을 구성해야 합니다.
- 기존 마우스 `Invalid session ID`는 다른 에러입니다. 이번 Eye 프로젝트 UUID 매핑 수정으로
  마우스 Edge Function을 고치는 것은 아닙니다.
- `public.uxds_eye_events`는 RLS가 켜져 있고 anon/authenticated의 SELECT가 차단돼
  있으므로 웹 클라이언트에서 즉시 조회할 수 없습니다.
