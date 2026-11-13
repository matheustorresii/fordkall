import { useCallback, useRef, useState } from 'react'
import { playCallSound } from '../services/callSounds'

export function useDeafenControl(
  feedback: typeof playCallSound = playCallSound,
) {
  const [deafened, setDeafened] = useState(false)
  const current = useRef(false)
  const toggleDeafen = useCallback(() => {
    const next = !current.current
    current.current = next
    setDeafened(next)
    feedback(next ? 'deafen' : 'undeafen')
  }, [feedback])
  return { deafened, toggleDeafen }
}
