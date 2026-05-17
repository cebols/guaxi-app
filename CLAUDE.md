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

## Economia de tokens — leitura de arquivos
Antes de usar Read em qualquer arquivo, perguntar: o conteúdo já está na janela de contexto desta sessão?
- Se foi lido nesta sessão e não foi modificado desde então → não ler de novo.
- Se foi modificado por uma ferramenta (Edit/Write) → o estado atualizado já está no contexto, não precisa re-ler para verificar.
- Só ler quando o arquivo genuinamente não está no contexto ou quando precisa de uma seção específica ainda não vista.
