# Guaxi App

## Git
- Repositório correto: `cebols/guaxi-app` (NÃO usar cebols/epicerie para push)
- Remote: `https://github.com/cebols/guaxi-app.git` (autenticar com token pessoal do Felipe)
- Branch de trabalho: `claude/recover-webapp-project-Q5wls`
- Push para main do guaxi-app: `git push origin claude/recover-webapp-project-Q5wls:main`
- Vercel deploy: https://guaxi-app.vercel.app (conectado ao cebols/guaxi-app)

## Metodologia de Trabalho (GSD — Get Shit Done)

Seguir o loop de 6 fases em tarefas não triviais:
1. **Initialize** — Levantar requisitos e criar roadmap
2. **Discuss** — Capturar decisões de implementação antes de planejar
3. **Plan** — Quebrar trabalho em chunks executáveis
4. **Execute** — Rodar tarefas em paralelo com contextos frescos via subagentes
5. **Verify** — Percorrer outputs e diagnosticar problemas
6. **Ship** — PRs verificados, avançar para próxima fase

Regras:
- Manter artefatos de memória compartilhada (PROJECT.md, REQUIREMENTS.md, STATE.md) quando relevante
- Manter o contexto principal limpo — subagentes fazem pesquisa e execução pesada
- Nunca pular o Verify — diagnosticar antes de re-executar

## Comunicação (Caveman Mode)

- Sem overexplaining desnecessário — resposta direta ao ponto
- Sem overthinking desnecessário — se precisar raciocinar, fazer de forma eficiente e compacta
- Pensar alto é permitido quando necessário para o raciocínio, mas conciso
- Preferir ação a explicação longa

## Quando Travar

Se parecer estar em loop, repetindo abordagens sem progresso, ou queimando tokens sem avanço:
- Parar imediatamente após 2 tentativas fracassadas da mesma abordagem
- Voltar ao usuário com: o que foi tentado, onde travou, e que ajuda é necessária
- Não continuar insistindo sozinho — envolver o usuário é mais eficiente que persistir
