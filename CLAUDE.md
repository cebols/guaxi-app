# Guaxi App

## Git
- Repositório: `cebols/guaxi-app`
- Remote: `https://github.com/cebols/guaxi-app.git`
- Vercel deploy: https://guaxi-app.vercel.app

## Workflow
- Sempre mergear direto na main: `git push origin <branch>:main`
- Respostas curtas, objetivas. Sem overexplain.

## Configuração obrigatória no início de cada sessão
Container é efêmero — antes de qualquer push:
```
git remote set-url origin https://github.com/cebols/guaxi-app.git
echo "https://TOKEN:x-oauth-basic@github.com" > ~/.git-credentials
```
Token: usuário pede no início da sessão ou está no histórico da thread.

## Economia de tokens — leitura de arquivos
Antes de usar Read em qualquer arquivo, perguntar: o conteúdo já está na janela de contexto desta sessão?
- Se foi lido nesta sessão e não foi modificado desde então → não ler de novo.
- Se foi modificado por uma ferramenta (Edit/Write) → o estado atualizado já está no contexto, não precisa re-ler para verificar.
- Só ler quando o arquivo genuinamente não está no contexto ou quando precisa de uma seção específica ainda não vista.
