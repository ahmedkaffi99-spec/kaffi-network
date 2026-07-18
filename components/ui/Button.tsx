import { ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success'
  size?: 'sm' | 'md' | 'lg'
}

const variants: Record<string, string> = {
  primary: 'bg-gold-500 hover:bg-gold-400 text-navy-950 font-semibold',
  secondary: 'bg-navy-700 hover:bg-navy-600 text-white border border-navy-600',
  danger: 'bg-red-900/40 hover:bg-red-900/70 text-red-400 border border-red-800/50',
  ghost: 'text-gray-400 hover:text-white hover:bg-navy-700',
  success: 'bg-emerald-900/40 hover:bg-emerald-900/70 text-emerald-400 border border-emerald-800/50',
}

const sizes: Record<string, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-lg',
  md: 'px-4 py-2 text-sm rounded-xl',
  lg: 'px-6 py-3 text-base rounded-xl',
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
