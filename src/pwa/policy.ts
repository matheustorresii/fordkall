export const isInstalledDisplay = (standalone: boolean, iosStandalone: boolean, referrer: string) =>
  standalone || iosStandalone || /^android-app:\/\/dev\.elevena3\.fordkall\/?$/.test(referrer)

// Presentation only, never authentication. TWA referrers/display mode can disappear on reload;
// the launcher/start_url hint is retained per window, not across unrelated browser tabs.
export const appLaunchHint = (href: string, previous: string | null) => {
  const sources = new URL(href).searchParams.getAll('source')
  if (sources.includes('android')) return 'android'
  if (sources.includes('pwa')) return 'pwa'
  return previous === 'android' || previous === 'pwa' ? previous : ''
}

export const canApplyUpdate = (inCall: boolean, applying: boolean, online: boolean) =>
  !inCall && !applying && online

export const installInstructions = (userAgent: string) => {
  if (/iPad|iPhone|iPod/i.test(userAgent) || /Macintosh.*Mobile/i.test(userAgent)) {
    return { platform: 'ios' as const, steps: ['Abra este site no Safari.', 'Toque em Compartilhar.', 'Escolha “Adicionar à Tela de Início” e confirme.'] }
  }
  if (/Android/i.test(userAgent)) {
    return { platform: 'android' as const, steps: ['Abra este site no Chrome atualizado.', 'No menu ⋮, toque em “Instalar app” ou “Adicionar à tela inicial”.', 'Confirme a instalação. Seu login permanece no mesmo navegador.'] }
  }
  return { platform: 'desktop' as const, steps: ['Abra este site no Chrome, Edge ou Safari compatível.', 'Use a opção de instalar aplicativo ou adicionar ao Dock no menu do navegador.'] }
}
