FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN python -m app.ml.train

EXPOSE 8000

CMD ["sh", "-c", "python -m data.seed && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
