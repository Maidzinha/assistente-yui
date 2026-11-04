import type { ConfirmRequest } from '@shared/types'
import { Icon } from './Icon'
import { Button, Modal } from './ui'

export function ConfirmDialog({ req, onAnswer }: { req: ConfirmRequest; onAnswer(approved: boolean): void }) {
  return (
    <Modal
      title="Confirmar ação"
      onClose={() => onAnswer(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => onAnswer(false)}>Não fazer</Button>
          <Button variant="primary" icon="check" onClick={() => onAnswer(true)}>Confirmar</Button>
        </>
      }
    >
      <p className="confirm-lead">
        {req.source === 'voice' ? 'Você pediu por voz' : 'Você pediu'} para a Yui fazer o seguinte:
      </p>
      <div className="confirm-box">
        <strong>{req.summary}</strong>
        {req.details.length > 0 && (
          <ul>{req.details.map((d) => <li key={d}><code>{d}</code></li>)}</ul>
        )}
      </div>
      <p className="muted small">Nada será feito sem a sua confirmação.</p>
    </Modal>
  )
}

export function MicConsentDialog({ onAccept, onDecline }: { onAccept(): void; onDecline(): void }) {
  return (
    <Modal
      title="Permitir o microfone?"
      onClose={onDecline}
      footer={
        <>
          <Button variant="ghost" onClick={onDecline}>Agora não</Button>
          <Button variant="primary" icon="mic" onClick={onAccept}>Permitir e começar</Button>
        </>
      }
    >
      <div className="consent">
        <Icon name="shield" size={28} />
        <ul>
          <li>O microfone só é ligado quando você toca no botão de falar, e desliga ao encerrar.</li>
          <li>Sua fala é transcrita pelo servidor de voz <strong>local</strong> configurado neste PC.</li>
          <li>O áudio fica apenas na memória durante a transcrição e <strong>não é gravado nem salvo</strong>. Só o texto entra no histórico.</li>
          <li>O Windows também pode pedir permissão de microfone para aplicativos da área de trabalho.</li>
        </ul>
      </div>
    </Modal>
  )
}
