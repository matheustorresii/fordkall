import { useCallback, useEffect, useRef, useState } from 'react'
import type { Room } from 'livekit-client'
import type { ChatMessage } from '../types'
import { participantProfileFromMetadata } from '../services/profile'

const TEXT_TOPIC = 'ford-kall.chat.text.v1'
const IMAGE_TOPIC = 'ford-kall.chat.image.v1'
export const MAX_CHAT_IMAGE_SIZE = 4 * 1024 * 1024
const MAX_MESSAGES = 120

const supportedImageTypes = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
])

const streamTimeout = (milliseconds: number) => {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(
    () => controller.abort(new DOMException('Tempo limite excedido.', 'TimeoutError')),
    milliseconds,
  )
  return { signal: controller.signal, clear: () => window.clearTimeout(timeoutId) }
}

export const useRoomChat = (room: Room) => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [error, setError] = useState('')
  const objectUrls = useRef<Set<string>>(new Set())

  const addMessage = useCallback((message: ChatMessage) => {
    setMessages((current) => {
      if (current.some((item) => item.id === message.id)) return current
      const next = [...current, message].slice(-MAX_MESSAGES)
      const retainedIds = new Set(next.map((item) => item.id))
      for (const item of current) {
        if (!retainedIds.has(item.id) && item.imageUrl) {
          URL.revokeObjectURL(item.imageUrl)
          objectUrls.current.delete(item.imageUrl)
        }
      }
      return next
    })
  }, [])

  useEffect(() => {
    const receiveText = (
      reader: Parameters<Parameters<Room['registerTextStreamHandler']>[1]>[0],
      participantInfo: { identity: string },
    ) => {
      const timeout = streamTimeout(20_000)
      void reader
        .readAll({ signal: timeout.signal })
        .then((text) => {
          const cleanText = text.trim().slice(0, 2_000)
          if (!cleanText) return
          const participant = room.remoteParticipants.get(participantInfo.identity)
          const publicProfile = participantProfileFromMetadata(participant?.metadata)
          addMessage({
            id: reader.info.id,
            kind: 'text',
            senderIdentity: participantInfo.identity,
            senderName: participant?.name || participantInfo.identity,
            senderAvatarUrl: publicProfile.avatarDataUrl,
            senderAppearance: publicProfile.appearance,
            isLocal: false,
            sentAt: reader.info.timestamp || Date.now(),
            text: cleanText,
            status: 'sent',
          })
        })
        .catch(() => setError('Uma mensagem não chegou por completo.'))
        .finally(timeout.clear)
    }

    const receiveImage = (
      reader: Parameters<Parameters<Room['registerByteStreamHandler']>[1]>[0],
      participantInfo: { identity: string },
    ) => {
      if (
        !supportedImageTypes.has(reader.info.mimeType) ||
        (reader.info.size && reader.info.size > MAX_CHAT_IMAGE_SIZE)
      ) {
        setError('Uma imagem foi ignorada por formato ou tamanho inválido.')
        const timeout = streamTimeout(45_000)
        void reader.readAll({ signal: timeout.signal }).catch(() => undefined).finally(timeout.clear)
        return
      }

      const timeout = streamTimeout(45_000)
      void reader
        .readAll({ signal: timeout.signal })
        .then((chunks) => {
          const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
          if (size > MAX_CHAT_IMAGE_SIZE) {
            setError('Uma imagem maior que 4 MB foi ignorada.')
            return
          }
          const blobParts = chunks.map(
            (chunk) => Uint8Array.from(chunk).buffer as ArrayBuffer,
          )
          const url = URL.createObjectURL(
            new Blob(blobParts, { type: reader.info.mimeType }),
          )
          objectUrls.current.add(url)
          const participant = room.remoteParticipants.get(participantInfo.identity)
          const publicProfile = participantProfileFromMetadata(participant?.metadata)
          addMessage({
            id: reader.info.id,
            kind: 'image',
            senderIdentity: participantInfo.identity,
            senderName: participant?.name || participantInfo.identity,
            senderAvatarUrl: publicProfile.avatarDataUrl,
            senderAppearance: publicProfile.appearance,
            isLocal: false,
            sentAt: reader.info.timestamp || Date.now(),
            imageUrl: url,
            imageName: reader.info.name || 'Imagem',
            status: 'sent',
          })
        })
        .catch(() => setError('Uma imagem não chegou por completo.'))
        .finally(timeout.clear)
    }

    room.registerTextStreamHandler(TEXT_TOPIC, receiveText)
    room.registerByteStreamHandler(IMAGE_TOPIC, receiveImage)
    return () => {
      room.unregisterTextStreamHandler(TEXT_TOPIC)
      room.unregisterByteStreamHandler(IMAGE_TOPIC)
    }
  }, [addMessage, room])

  useEffect(
    () => () => {
      for (const url of objectUrls.current) URL.revokeObjectURL(url)
      objectUrls.current.clear()
    },
    [],
  )

  const sendText = useCallback(
    async (value: string) => {
      const text = value.trim().slice(0, 2_000)
      if (!text) return false
      setError('')
      try {
        const info = await room.localParticipant.sendText(text, { topic: TEXT_TOPIC })
        const publicProfile = participantProfileFromMetadata(room.localParticipant.metadata)
        addMessage({
          id: info.id,
          kind: 'text',
          senderIdentity: room.localParticipant.identity,
          senderName: room.localParticipant.name || room.localParticipant.identity,
          senderAvatarUrl: publicProfile.avatarDataUrl,
          senderAppearance: publicProfile.appearance,
          isLocal: true,
          sentAt: info.timestamp || Date.now(),
          text,
          status: 'sent',
        })
        return true
      } catch {
        setError('Não foi possível enviar a mensagem.')
        return false
      }
    },
    [addMessage, room],
  )

  const sendImage = useCallback(
    async (file: File) => {
      if (!supportedImageTypes.has(file.type)) {
        setError('Use uma imagem JPG, PNG, WEBP ou GIF.')
        return false
      }
      if (file.size > MAX_CHAT_IMAGE_SIZE) {
        setError('A imagem pode ter no máximo 4 MB.')
        return false
      }

      setError('')
      const localId = crypto.randomUUID()
      const imageUrl = URL.createObjectURL(file)
      const publicProfile = participantProfileFromMetadata(room.localParticipant.metadata)
      objectUrls.current.add(imageUrl)
      addMessage({
        id: localId,
        kind: 'image',
        senderIdentity: room.localParticipant.identity,
        senderName: room.localParticipant.name || room.localParticipant.identity,
        senderAvatarUrl: publicProfile.avatarDataUrl,
        senderAppearance: publicProfile.appearance,
        isLocal: true,
        sentAt: Date.now(),
        imageUrl,
        imageName: file.name,
        status: 'sending',
      })

      try {
        await room.localParticipant.sendFile(file, { topic: IMAGE_TOPIC })
        setMessages((current) =>
          current.map((message) =>
            message.id === localId ? { ...message, status: 'sent' } : message,
          ),
        )
        return true
      } catch {
        setMessages((current) =>
          current.map((message) =>
            message.id === localId ? { ...message, status: 'error' } : message,
          ),
        )
        setError('Não foi possível enviar a imagem.')
        return false
      }
    },
    [addMessage, room],
  )

  return { messages, error, clearError: () => setError(''), sendText, sendImage }
}
