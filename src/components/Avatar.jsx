import { useEffect, useState } from 'react'
import Icon from './Icon'
import './ui.css'

export default function Avatar({ name = '', src, size = 44, className = '' }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  // (name || '') also covers name === null, which the default value does not
  const initials = (name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')

  return (
    <span className={`avatar ${className}`} style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {src && !failed ? (
        <img src={src} alt="" onError={() => setFailed(true)} />
      ) : initials ? (
        <span aria-hidden="true">{initials}</span>
      ) : (
        <Icon name="user" size={Math.round(size * 0.5)} />
      )}
    </span>
  )
}