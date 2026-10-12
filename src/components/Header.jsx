import React from 'react'
import './Header.css'

export default function Header({ user, onSignOut }) {
  return (
    <header className="header">
      <div className="header-left">
        <div className="header-title">Shakti Synergetics</div>
        <div className="header-subtitle">Production &amp; Quality Control</div>
      </div>

      {user && (
        <div className="header-right">
          <div className="header-user">
            <span className="header-user-name">{user.name}</span>
            <span className="header-user-role">{user.role}</span>
          </div>
          <button className="header-signout-btn" onClick={onSignOut}>
            Sign Out / साइन आउट
          </button>
        </div>
      )}
    </header>
  )
}
