import { Link } from 'react-router-dom'
import Icon from './Icon'
import './ui.css'

// action: { label, to } or { label, onClick }
export default function EmptyState({ icon = 'inbox', title, text, action, compact = false }) {
  return (
    <div className={`ph-empty ${compact ? 'ph-empty--compact' : ''}`}>
      <span className="ph-empty__icon"><Icon name={icon} size={28} /></span>
      <h3 className="ph-empty__title">{title}</h3>
      {text && <p className="ph-empty__text">{text}</p>}
      {action && (action.to
        ? <Link to={action.to} className="btn btn--primary">{action.label}</Link>
        : <button type="button" className="btn btn--primary" onClick={action.onClick}>{action.label}</button>)}
    </div>
  )
}
