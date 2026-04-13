# Alembic autogenerate 및 SQLAlchemy metadata 등록을 위해
# 모든 ORM 모델을 이 파일에서 import.
# 실제 로직에서 모델을 직접 import할 때는 각 모듈에서 가져오세요.

from app.db.database import Base  # noqa: F401

from app.auth.models import User, UserProfile       # noqa: F401
from app.schedule.models import Schedule, ExamSchedule  # noqa: F401
from app.share.models import ShareToken             # noqa: F401
from app.ai_chat.models import AIChatLog            # noqa: F401
from app.syllabus.models import Syllabus, SyllabusAnalysis  # noqa: F401
