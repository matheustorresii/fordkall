import { useEffect, useRef } from 'react'
import type { Room } from 'livekit-client'
import type { GarticState } from '../games/partyGames'
import type { DrawingStroke } from '../games/drawing/model'
import { useRoomDrawing } from './useRoomDrawing'

/** Retain the live drawing outside its UI, including while the artist minimizes it. */
export const useRoomSketch = (room: Room, state: GarticState) => {
  const board = useRoomDrawing(room, state.boardId, state.boardArtist)
  const archive = useRef(new Map<string, DrawingStroke[]>())
  useEffect(() => {
    archive.current.clear()
  }, [state.gameId])
  useEffect(() => {
    if (!state.boardId) return
    let revision = -1
    const save = () => {
      const next = board.session.getView().sceneRevision
      if (revision === next) return
      revision = next
      archive.current.set(state.boardId, board.session.replica.scene())
      // Telephone has at most twelve turns. Classic modes need no older canvases.
      const limit = state.settings.mode === 'telephone' ? 12 : 1
      while (archive.current.size > limit)
        archive.current.delete(archive.current.keys().next().value!)
    }
    save()
    const unsubscribe = board.session.subscribe(save)
    return () => {
      save()
      unsubscribe()
    }
  }, [board.session, state.boardId, state.settings.mode])
  return { ...board, archive }
}
export type RoomSketch = ReturnType<typeof useRoomSketch>
