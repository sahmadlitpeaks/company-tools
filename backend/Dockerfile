FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_ROOT_USER_ACTION=ignore

WORKDIR /app

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends build-essential libpq5 postgresql-client fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
COPY requirements-sharepoint-nlp.txt .
ARG SHAREPOINT_NLP=false
RUN python -m pip install --no-cache-dir --upgrade pip setuptools wheel \
    && python -m pip install --no-cache-dir -r requirements.txt

RUN if [ "$SHAREPOINT_NLP" = "true" ]; then python -m pip install --no-cache-dir -r requirements-sharepoint-nlp.txt; fi

COPY . .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
