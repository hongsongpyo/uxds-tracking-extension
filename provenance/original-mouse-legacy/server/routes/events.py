# server/routes/events.py

from flask import Blueprint, jsonify, request

from services.event_service import save_event_batch

events_bp = Blueprint("events", __name__)


@events_bp.route("/events/health", methods=["GET"])
def events_health():
    return jsonify({
        "status": "ok",
        "message": "Events route is working."
    }), 200


@events_bp.route("/events", methods=["POST"])
def receive_events():
    """
    확장프로그램에서 전송한 이벤트 배치를 수신한다.

    expected payload:
    {
        "project_id": "prj_42cb9ad1e597",
        "session_id": "session_1712391000000_ab12cd34",
        "events": [
            {...},
            {...}
        ]
    }
    """
    try:
        data = request.get_json(silent=True)

        if not data:
            return jsonify({
                "success": False,
                "error": "JSON 본문이 비어 있거나 잘못되었습니다."
            }), 400

        project_id = data.get("project_id")
        session_id = data.get("session_id")
        events = data.get("events")

        if not project_id:
            return jsonify({
                "success": False,
                "error": "project_id가 필요합니다."
            }), 400

        if not session_id:
            return jsonify({
                "success": False,
                "error": "session_id가 필요합니다."
            }), 400

        if events is None:
            return jsonify({
                "success": False,
                "error": "events 필드가 필요합니다."
            }), 400

        if not isinstance(events, list):
            return jsonify({
                "success": False,
                "error": "events는 리스트 형식이어야 합니다."
            }), 400

        if len(events) == 0:
            return jsonify({
                "success": True,
                "message": "저장할 이벤트가 없습니다.",
                "saved_count": 0,
                "project_id": project_id,
                "session_id": session_id
            }), 200

        save_result = save_event_batch(
            project_id=project_id,
            session_id=session_id,
            events=events
        )

        return jsonify({
            "success": True,
            "message": "이벤트가 저장되었습니다.",
            "project_id": project_id,
            "session_id": session_id,
            "saved_count": save_result["saved_count"],
            "all_events_file": save_result["all_events_file"],
            "session_file": save_result["session_file"]
        }), 200

    except Exception as error:
        return jsonify({
            "success": False,
            "error": f"이벤트 저장 중 서버 오류가 발생했습니다: {str(error)}"
        }), 500
