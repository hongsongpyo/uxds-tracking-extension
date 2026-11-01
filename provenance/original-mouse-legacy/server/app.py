# server/app.py

from flask import Flask
from flask_cors import CORS

from routes.events import events_bp
from routes.visualize import visualize_bp


def create_app():
    app = Flask(__name__)

    # 확장프로그램 및 로컬 개발 환경에서의 요청 허용
    CORS(app)

    # Blueprint 등록
    app.register_blueprint(events_bp)
    app.register_blueprint(visualize_bp)

    @app.route("/", methods=["GET"])
    def health_check():
        return {
            "status": "ok",
            "message": "Web Interaction Tracker server is running."
        }, 200

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)