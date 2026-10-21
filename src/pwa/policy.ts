export const isInstalledDisplay = (standalone: boolean, iosStandalone: boolean, referrer: string) =>
  standalone || iosStandalone || referrer === 'android-app://dev.elevena3.fordkall'

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
