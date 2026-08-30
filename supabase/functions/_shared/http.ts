import { corsHeaders } from './cors.ts'

export class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })

export const errorResponse = (error: unknown) => {
  console.error(error)
  if (error instanceof HttpError) return json({ error: error.message }, error.status)
  return json({ error: 'INTERNAL_ERROR' }, 500)
}

export const readJson = async <T>(request: Request): Promise<T> => {
  try {
    return await request.json() as T
  } catch {
    throw new HttpError(400, 'INVALID_JSON')
  }
}
