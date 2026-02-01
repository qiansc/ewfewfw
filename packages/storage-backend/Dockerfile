FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY packages/storage-backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY packages/storage-backend/src /app/src

EXPOSE 8055

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8055"]
