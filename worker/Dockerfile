FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/app/worker
WORKDIR /app
COPY worker/requirements.txt ./worker/requirements.txt
RUN pip install --no-cache-dir -r worker/requirements.txt
COPY worker/app ./worker/app
COPY worker/sql ./worker/sql
COPY backend/certs ./backend/certs
WORKDIR /app/worker
CMD ["python", "-m", "app.main", "--loop"]
