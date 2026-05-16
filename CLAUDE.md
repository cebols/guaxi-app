# Guaxi App

## Git
- Repositório correto: `cebols/guaxi-app` (NÃO usar cebols/epicerie para push)
- Remote: `https://github.com/cebols/guaxi-app.git`
- Branch de trabalho atual: `claude/guaxi-app-continue-JshAR`
- Push: `git push origin claude/guaxi-app-continue-JshAR:main && git push origin claude/guaxi-app-continue-JshAR`
- Vercel deploy: https://guaxi-app.vercel.app (conectado ao cebols/guaxi-app)

## Configuração obrigatória no início de cada sessão
O container é efêmero — rodar isso antes de qualquer push:
```
git config --global credential.helper store
echo "https://TOKEN:x-oauth-basic@github.com" > ~/.git-credentials
git remote set-url origin https://github.com/cebols/guaxi-app.git
```
O token está no histórico desta thread. Substituir TOKEN pelo valor real.
