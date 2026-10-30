# Modelos de e-mail do SteelDay (Supabase Auth)

Cole cada modelo em Supabase → Authentication → Emails → Templates, no projeto `opengym`.

| Modelo no painel  | Assunto sugerido                      | Arquivo                  |
|-------------------|---------------------------------------|--------------------------|
| Confirm signup    | Confirme seu cadastro no SteelDay     | confirmar-cadastro.html  |
| Magic link        | Seu link de acesso ao SteelDay        | link-de-acesso.html      |
| Reset password    | Redefina sua senha do SteelDay        | redefinir-senha.html     |
| Change email      | Confirme seu novo e-mail              | trocar-email.html        |

Os modelos usam `{{ .ConfirmationURL }}`, a variável do próprio Supabase para o link.
