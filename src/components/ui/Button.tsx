import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './Button.css'

type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'
type ButtonSize = 'small' | 'medium'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'quiet' | 'secondary' | 'danger'
  size?: ButtonSize
}

const joinClassNames = (...values: Array<string | undefined>) => values.filter(Boolean).join(' ')

export const Button = ({
  children,
  className,
  leadingIcon,
  trailingIcon,
  size = 'medium',
  variant = 'secondary',
  ...props
}: ButtonProps) => (
  <button
    {...props}
    className={joinClassNames('ui-button', `ui-button--${variant}`, `ui-button--${size}`, className)}
  >
    {leadingIcon && <span className="ui-button__icon" aria-hidden="true">{leadingIcon}</span>}
    <span className="ui-button__label">{children}</span>
    {trailingIcon && <span className="ui-button__icon" aria-hidden="true">{trailingIcon}</span>}
  </button>
)

export const IconButton = ({
  children,
  className,
  size = 'medium',
  variant = 'quiet',
  ...props
}: IconButtonProps) => (
  <button
    {...props}
    className={joinClassNames('ui-icon-button', `ui-icon-button--${variant}`, `ui-icon-button--${size}`, className)}
  >
    {children}
  </button>
)
