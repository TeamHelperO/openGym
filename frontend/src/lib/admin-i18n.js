// The admin dashboard's words (views/Admin.jsx, lib/audit.js). Upstream keeps that page in English
// only, out of the per-language packs; SteelDay is run in Portuguese, so the dashboard follows the
// app's language when it is pt or pt-BR and stays in English otherwise. `{0}`, `{1}` are filled in
// order, as in t().
import { getLang } from './i18n-core.js'

const PT = {
  // general
  'never': 'nunca',
  'just now': 'agora mesmo',
  '{0} min ago': 'há {0} min',
  '{0} h ago': 'há {0} h',
  '{0} d ago': 'há {0} d',
  'Copied': 'Copiado',
  'Copied {0}': '{0} copiado',
  'Done': 'Pronto',
  'Loading…': 'Carregando…',
  'Back': 'Voltar',
  'refresh': 'atualizar',
  'copy': 'copiar',
  'copy code': 'copiar código',
  'Continue': 'Continuar',
  'today {0}': 'hoje {0}',

  // recovery (Supabase: a password-reset link)
  'Recovery link for {0}': 'Link de recuperação para {0}',
  'Send this link to {0}. Opening it signs them in and lets them choose a new password. It works once, until {1}, and will not be shown again.':
    'Envie este link para {0}. Ao abrir, a pessoa entra na conta e escolhe uma nova senha. Funciona uma vez, até {1}, e não será mostrado de novo.',
  'Recovery link for {0}?': 'Gerar link de recuperação para {0}?',
  'For someone who cannot sign in any more: a one-time link that signs them in and lets them set a new password. It is shown once and is valid for one hour.':
    'Para quem não consegue mais entrar: um link de uso único que entra na conta e permite definir uma nova senha. Ele aparece uma vez só e vale por uma hora.',
  'Create recovery link': 'Gerar link',
  'Recovery link': 'Link de recuperação',
  'Lost the password and the e-mail link does not arrive? A one-time link you hand over lets them in to set a new one.':
    'Esqueceu a senha e o e-mail de recuperação não chega? Um link de uso único que você entrega permite entrar e criar uma nova.',
  'The owner gets back in with “Forgot your password?” on the sign-in screen.':
    'A dona da conta recupera o acesso pelo “Esqueceu a senha?” na tela de login.',

  // user detail
  'Account deleted': 'Conta excluída',
  'User disabled': 'Usuário desativado',
  'User enabled': 'Usuário reativado',
  '{0} is an admin now': '{0} agora é admin',
  '{0} is no longer an admin': '{0} não é mais admin',
  'Make {0} the owner?': 'Tornar {0} dono(a)?',
  'They get everything you can do here, including removing admins and clearing the activity log. You stay an admin, but only they can change that.':
    'A pessoa passa a poder fazer tudo o que você faz aqui, inclusive remover admins e limpar o log de atividades. Você continua admin, mas só ela poderá mudar isso.',
  'Hand it over': 'Transferir',
  '{0} owns this instance now': '{0} agora é dono(a) do SteelDay',
  'owner': 'dono(a)',
  'admin': 'admin',
  'disabled': 'desativado',
  'invite {0}': 'convite {0}',
  'sign-in e-mail': 'e-mail de acesso',
  'joined {0}': 'entrou em {0}',
  'Workouts': 'Treinos',
  'Weigh-ins': 'Pesagens',
  'Measurements': 'Medidas',
  'Routines': 'Rotinas',
  'Last sync': 'Última sincronização',
  'Remove {0} as admin?': 'Remover {0} como admin?',
  'They keep their account and data, but lose this page.': 'A pessoa mantém a conta e os dados, mas perde acesso a esta página.',
  'Remove admin': 'Remover admin',
  'Make {0} an admin?': 'Tornar {0} admin?',
  'They can see everyone on this instance, disable accounts, hand out invites and set up the Coach. Only you can add or remove admins.':
    'A pessoa poderá ver todos os usuários, desativar contas, criar convites e configurar o Coach. Só você pode adicionar ou remover admins.',
  'Make admin': 'Tornar admin',
  'Admins run the instance with you. Remove the role to delete or disable their account.':
    'Admins administram o SteelDay com você. Remova o cargo para poder excluir ou desativar a conta.',
  'Admins help run the instance. You stay the owner.': 'Admins ajudam a administrar. Você continua dono(a).',
  'Make owner': 'Tornar dono(a)',
  'There is one owner. Handing it over makes you a regular admin.': 'Existe um único dono(a). Ao transferir, você vira um admin comum.',
  'Disable {0}?': 'Desativar {0}?',
  'They are signed out everywhere and can no longer sync or log in until re-enabled. Their data stays.':
    'A pessoa é desconectada de todos os aparelhos e não consegue mais entrar nem sincronizar até ser reativada. Os dados continuam guardados.',
  'Disable': 'Desativar',
  'Enable account': 'Reativar conta',
  'Disable account': 'Desativar conta',
  'Enabling lets them sign in and sync again.': 'Reativar permite entrar e sincronizar de novo.',
  'Disabling signs them out everywhere and blocks sign-in. Nothing is deleted.': 'Desativar desconecta de todos os aparelhos e bloqueia o login. Nada é excluído.',
  'Delete {0}?': 'Excluir {0}?',
  'Everything goes: their workouts, weigh-ins, routines, passkeys and notifications. This cannot be undone, and the invite code they joined with stays used. Download their data first if they might want it.':
    'Tudo será apagado: treinos, pesagens, rotinas, fotos e notificações. Não dá para desfazer, e o código de convite usado continua marcado como usado. Baixe os dados antes, caso a pessoa queira.',
  'Delete {0} for good?': 'Excluir {0} definitivamente?',
  'Last chance. There’s no undo and no backup of this on the server.': 'Última chance. Não tem como desfazer e não fica cópia no servidor.',
  'Delete account': 'Excluir conta',
  'Download their data': 'Baixar os dados',
  'Deleting removes the account and every trace of its training history from this server.':
    'Excluir remove a conta e todo o histórico de treinos do servidor.',
  'Workout history': 'Histórico de treinos',
  '{0} sets': '{0} séries',
  'No workouts logged.': 'Nenhum treino registrado.',

  // invites
  'Code {0} created & copied': 'Código {0} criado e copiado',
  'Revoke code {0}?': 'Revogar o código {0}?',
  'Anyone who has it can no longer use it. People who already signed up with it are not affected.':
    'Quem tiver o código não poderá mais usá-lo. Quem já se cadastrou com ele não é afetado.',
  'Revoke': 'Revogar',
  'Code revoked': 'Código revogado',
  'Invite codes': 'Códigos de convite',
  'New code': 'Novo código',
  'Sign-up is invite-only: someone needs one of these codes to create a profile. Each code works once.':
    'O cadastro é só por convite: é preciso um destes códigos para criar um perfil. Cada código funciona uma vez.',
  'Sign-up is open, so codes are optional here. They only record who invited whom.':
    'O cadastro está aberto, então os códigos são opcionais. Eles só registram quem convidou quem.',
  'Unused · tap to copy': 'Não usados · toque para copiar',
  'revoke': 'revogar',
  'Already used': 'Já usados',
  'used': 'usado',
  'No codes yet. "New code" makes one and copies it to your clipboard.': 'Nenhum código ainda. "Novo código" cria um e copia para a área de transferência.',

  // activity log
  'Clear the activity log?': 'Limpar o log de atividades?',
  'Every recorded event is deleted. The clear itself is logged, so the gap stays visible.':
    'Todos os eventos registrados são apagados. A própria limpeza fica registrada, então a lacuna continua visível.',
  'Clear': 'Limpar',
  'Activity log cleared': 'Log de atividades limpo',
  'Activity log': 'Log de atividades',
  'clear log': 'limpar log',
  'Who signed in, what failed, and what an admin changed.': 'Quem entrou, o que falhou e o que um admin alterou.',
  '{0} events': '{0} eventos',
  ', kept for {0} days': ', guardados por {0} dias',
  ', without IP addresses': ', sem endereços IP',
  'All': 'Todos',
  'Sign-ins': 'Acessos',
  'Admin': 'Admin',
  'Failed': 'Falhas',
  'failed': 'falhou',
  'Nothing logged yet.': 'Nada registrado ainda.',
  'Show more': 'Mostrar mais',
  'unknown caller': 'origem desconhecida',

  // dashboard
  'The server answered without a list of users.': 'O servidor respondeu sem a lista de usuários.',
  'Failed to load': 'Falha ao carregar',
  '{0} users · {1} active this week': '{0} usuários · {1} ativos esta semana',
  'Could not load': 'Não foi possível carregar',
  'Everything about running this instance: who uses it, how they get in, the AI Coach, and what has happened on it. Nothing here shows anyone\'s training data beyond counts.':
    'Tudo para administrar o SteelDay: quem usa, como entra, o Coach de IA e o que aconteceu. Nada aqui mostra os treinos de ninguém além de contagens.',
  'The last update failed': 'A última atualização falhou',
  'Could not load the users': 'Não foi possível carregar os usuários',
  'Try again': 'Tentar de novo',
  'The list below is the last one that loaded.': 'A lista abaixo é a última que carregou.',
  'It tries again every 15 seconds.': 'Tenta de novo a cada 15 segundos.',
  'Users': 'Usuários',
  'Training now': 'Treinando agora',
  'Active 7 days': 'Ativos em 7 dias',
  'Disabled': 'Desativados',
  'Sessions running at this moment. Tap a name for details.': 'Treinos acontecendo agora. Toque em um nome para ver detalhes.',
  '{0} · exercise {1} of {2} · {3}/{4} sets': '{0} · exercício {1} de {2} · {3}/{4} séries',
  'Everyone with a profile on this instance. Tap one to see their activity, to disable the account (nothing is deleted) or to delete it with all their data for good.':
    'Todos com perfil no SteelDay. Toque em um para ver a atividade, desativar a conta (nada é apagado) ou excluí-la de vez com todos os dados.',
  'training now · {0}': 'treinando agora · {0}',
  '{0} workouts': '{0} treinos',
  ' · last {0}': ' · último {0}',
  ' · last sync {0}': ' · sincronizado {0}',
  'push notifications on': 'notificações ativadas',
  'No users yet.': 'Nenhum usuário ainda.',

  // audit labels
  'Signed in': 'Entrou',
  'Sign-in failed': 'Falha ao entrar',
  'Created a profile': 'Criou um perfil',
  'Profile creation failed': 'Falha ao criar perfil',
  'Signup refused': 'Cadastro recusado',
  'Signed out': 'Saiu',
  'Signed out everywhere': 'Saiu de todos os aparelhos',
  'Deleted their own account': 'Excluiu a própria conta',
  'Set a password': 'Definiu uma senha',
  'Changed their password': 'Alterou a senha',
  'Disabled an account': 'Desativou uma conta',
  'Re-enabled an account': 'Reativou uma conta',
  'Deleted an account': 'Excluiu uma conta',
  'Made someone an admin': 'Tornou alguém admin',
  'Removed someone as admin': 'Removeu alguém como admin',
  'Handed the owner role on': 'Transferiu o cargo de dono(a)',
  'Created an invite code': 'Criou um código de convite',
  'Revoked an invite code': 'Revogou um código de convite',
  'Cleared the activity log': 'Limpou o log de atividades',
  'Became admin as the first profile': 'Virou admin como primeiro perfil',
  'Blocked from an admin action': 'Bloqueado em uma ação de admin',
  'Cleared unused photos and videos': 'Limpou fotos e vídeos não usados',
  'Too many photo or video requests': 'Pedidos demais de fotos ou vídeos',
  'Made a recovery link': 'Gerou um link de recuperação',
  'Unknown event': 'Evento desconhecido',
  'wrong password': 'senha errada',
  'the account is disabled': 'a conta está desativada',
  'the invite code was used or revoked in the meantime': 'o código de convite foi usado ou revogado nesse meio-tempo',
  'deleting their account': 'excluir a conta',
}

const isPt = () => { try { const l = getLang(); return l === 'pt' || l === 'pt-BR' } catch { return false } }

/** The dashboard's sentence `s` in the app's language when it is Portuguese, else as written. */
export function a(s, ...args) {
  const out = (isPt() && PT[s]) || s
  return args.length ? out.replace(/\{(\d+)\}/g, (m, i) => (args[i] != null ? String(args[i]) : m)) : out
}
