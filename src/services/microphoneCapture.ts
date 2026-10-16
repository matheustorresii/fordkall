import { getMicrophoneCaptureSettings } from '../storage/preferences'
import { microphoneConstraints } from './microphoneSettings'

/** Shared by initial room capture, unmute/retry and device defaults. */
export const microphoneCaptureOptions = () => microphoneConstraints(getMicrophoneCaptureSettings())
