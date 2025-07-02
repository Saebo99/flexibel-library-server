# AI Chatbot Server

[![License](https://img.shields.io/github/license/Saebo99/flexibel-library-server)](LICENSE)
[![Build](https://github.com/Saebo99/flexibel-library-server/actions/workflows/ci.yml/badge.svg)](https://github.com/Saebo99/flexibel-library-server/actions)
[![npm](https://img.shields.io/npm/v/@yourorg/chatbot-client)](https://www.npmjs.com/package/@yourorg/chatbot-client)
[![Deploy to Azure](https://azuredeploy.net/deploybutton.svg)](https://portal.azure.com/#create/Microsoft.ContainerApp?templateUri=https:%2F%2Fraw.githubusercontent.com%2F<user>%2F<repo>%2Fmain%2Finfra%2Fazuredeploy.json)

A production‑ready **Node.js** server that powers the **AI Chatbot API** – drop‑in support for conversational AI on any website or product.
Integrate in minutes with our `@yourorg/chatbot-client` npm package and an API key generated in your dashboard.

---

## ✨ Key Features

* **Plug‑and‑play embedding** – a single script or npm install
* **Multi‑source knowledge ingestion** – YouTube videos, PDFs, websites, plain files & more
* **Retrieval‑augmented generation (RAG)** – answers grounded in your private data
* **Granular API keys & usage quotas** – managed in the SaaS dashboard
* **Serverless‑friendly** – containerised, runs best on Azure Container Apps
* **OpenAI & Azure OpenAI compatible** – swap back‑ends via config

---

## 🏗️ Architecture

```mermaid
flowchart LR
    subgraph Frontend
        A[Web / Mobile App] --> B[@yourorg/chatbot-client]
    end
    B -->|HTTPS| C(API Gateway)
    C --> D(NodeJS Server)
    D -->|Vector Search| E[(Vector DB)]
    D -->|Transforms| F(Worker Pool)
    F -->|Store| E
    F -->|Blob| G>Azure Storage]
    C --> H(Auth Service)
```

*The server is stateless; scaling is as simple as adding replicas.*

---

## 🚀 Quick Start

### Prerequisites

* Node.js **>= 18**
* Docker (for local container run)
* An **OPENAI\_API\_KEY** (or Azure OpenAI equivalent)

### Local development

```bash
# clone & install
git clone https://github.com/Saebo99/flexibel-library-server.git
cd ai-chatbot-server
npm ci

# copy env template & set secrets
cp .env.sample .env
# edit OPENAI_API_KEY=...
# start dev server
npm run dev
```

### Using the API from JavaScript

```ts
import { Chatbot } from '@yourorg/chatbot-client';

const bot = new Chatbot({ apiKey: 'YOUR_API_KEY' });

const answer = await bot.ask('What are your opening hours?');
console.log(answer.text);
```

### cURL snippet

```bash
curl https://api.flexibel.ai/v0/chat \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "question": "YOUR_QUESTION",
        "history": "CONVERSATION_HISTORY",
        "conversationId": "CONVERSATION_ID",
        "temperature": TEMPERATURE_VALUE,
        "relevanceThreshold": RELEVANCE_THRESHOLD,
        "historyOn": true_or_false
      }'
```

---

## 🗃️ Ingesting Knowledge Sources

```bash
# Import a YouTube playlist
curl https://api.flexibel.ai/v0/importData \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "type": "DATA_SOURCE_TYPE",
        "url": "DATA_SOURCE_URL",
        "file": "FILE_PATH",
        "includePaths": ["PATHS_TO_INCLUDE"],
        "excludePaths": ["PATHS_TO_EXCLUDE"]
      }'
```

Supported loaders:

| Type    | Endpoint           | Notes                        |
| ------- | ------------------ | ---------------------------- |
| YouTube | `/sources/youtube` | Video or playlist URL        |
| PDF     | `/sources/file`    | `multipart/form-data` upload |
| Website | `/sources/webpage` | Crawls & embeds sub‑pages    |

---

## 🐳 Running in Docker

```bash
docker build -t yourorg/ai-chatbot-server .
docker run -p 8080:8080 --env-file .env yourorg/ai-chatbot-server
```

### Deploying to Azure Container Apps

```bash
az containerapp up \
   --name ai-chatbot-server \
   --resource-group my-rg \
   --image yourorg/ai-chatbot-server:latest \
   --env-vars $(cat .env | xargs) \
   --target-port 8080
```

---

## 🧪 Tests & Linting

```bash
npm test        # jest
npm run lint    # eslint + prettier
```

CI runs on every push and PR.

---

## 🤝 Contributing

1. Fork the repo
2. `git checkout -b feature/my-feature`
3. Commit & push
4. Open a PR – we ❤️ discussions!

---

## 📄 License

Distributed under the **MIT License** – see [`LICENSE`](LICENSE) for details.
