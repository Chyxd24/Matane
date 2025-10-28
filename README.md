# telegram-aifoundry-bot (Matane)

Bot Telegram yang menghubungkan ke Azure OpenAI / Azure Cognitive Services dan Speech endpoints. Starter project dengan webhook support, Redis optional, dan voice handling.

Quickstart
1. Copy server/.env.example -> server/.env and fill secrets (do NOT commit secrets to repo).
2. Install dependencies and run locally:
   cd server
   npm install
   npm run dev

3. For webhook testing use ngrok or deploy to Azure App Service and set WEBHOOK_DOMAIN.

Files included:
- .gitignore
- docker-compose.yml
- Procfile
- server/.env.example
- server/package.json
- package.json (root)
- server/index.js
- server/azureClient.js
- server/stt.js
- server/tts.js
- .github/workflows/azure-webapp-deploy.yml