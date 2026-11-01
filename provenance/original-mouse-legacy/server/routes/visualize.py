# server/routes/visualize.py

from flask import Blueprint, jsonify, request

from services.visualization_service import generate_heatmap, generate_scanpath

visualize_bp = Blueprint("visualize", __name__)


@visualize_bp.route("/visualize/health", methods=["GET"])
def visualize_health():
    return jsonify({
        "success": True,
        "message": "Visualize route is working."
    }), 200


@visualize_bp.route("/visualize/heatmap", methods=["POST"])
def create_heatmap():
    """
    특정 세션의 heatmap 생성 요청

    expected payload:
    {
        "session_id": "session_1712391000000_ab12cd34"
    }
    """
    try:
        data = request.get_json(silent=True)

        if not data:
            return jsonify({
                "success": False,
                "error": "JSON 본문이 비어 있거나 잘못되었습니다."
            }), 400

        session_id = data.get("session_id")

        if not session_id:
            return jsonify({
                "success": False,
                "error": "session_id가 필요합니다."
            }), 400

        result = generate_heatmap(session_id=session_id)

        return jsonify({
            "success": True,
            "message": "Heatmap 생성이 완료되었습니다.",
            "session_id": session_id,
            "output_file": result["output_file"],
            "point_count": result["point_count"]
        }), 200

    except FileNotFoundError as error:
        return jsonify({
            "success": False,
            "error": str(error)
        }), 404

    except ValueError as error:
        return jsonify({
            "success": False,
            "error": str(error)
        }), 400

    except Exception as error:
        return jsonify({
            "success": False,
            "error": f"Heatmap 생성 중 서버 오류가 발생했습니다: {str(error)}"
        }), 500


@visualize_bp.route("/visualize/scanpath", methods=["POST"])
def create_scanpath():
    """
    특정 세션의 scanpath 생성 요청

    expected payload:
    {
        "session_id": "session_1712391000000_ab12cd34"
    }
    """
    try:
        data = request.get_json(silent=True)

        if not data:
            return jsonify({
                "success": False,
                "error": "JSON 본문이 비어 있거나 잘못되었습니다."
            }), 400

        session_id = data.get("session_id")

        if not session_id:
            return jsonify({
                "success": False,
                "error": "session_id가 필요합니다."
            }), 400

        result = generate_scanpath(session_id=session_id)

        return jsonify({
            "success": True,
            "message": "Scanpath 생성이 완료되었습니다.",
            "session_id": session_id,
            "output_file": result["output_file"],
            "point_count": result["point_count"]
        }), 200

    except FileNotFoundError as error:
        return jsonify({
            "success": False,
            "error": str(error)
        }), 404

    except ValueError as error:
        return jsonify({
            "success": False,
            "error": str(error)
        }), 400

    except Exception as error:
        return jsonify({
            "success": False,
            "error": f"Scanpath 생성 중 서버 오류가 발생했습니다: {str(error)}"
        }), 500