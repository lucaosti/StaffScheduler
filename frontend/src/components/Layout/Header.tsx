import React from 'react';

interface HeaderProps {
  onToggleSidebar: () => void;
}

const Header: React.FC<HeaderProps> = ({ onToggleSidebar }) => {
  return (
    <div className="header">
      <button
        className="btn btn-link text-dark p-0 me-3"
        onClick={onToggleSidebar}
        style={{ fontSize: '1.25rem' }}
      >
        <i className="bi bi-list"></i>
      </button>
      
      <h5 className="mb-0 text-dark">Staff Scheduler</h5>
      
      <div className="ms-auto d-flex align-items-center">
        <div className="dropdown">
          <button
            className="btn btn-link text-dark p-0"
            type="button"
            data-bs-toggle="dropdown"
            aria-expanded="false"
          >
            <i className="bi bi-bell" style={{ fontSize: '1.25rem' }}></i>
          </button>
          <ul className="dropdown-menu dropdown-menu-end">
            <li><h6 className="dropdown-header">Notifications</h6></li>
            <li><button className="dropdown-item" type="button">No new notifications</button></li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default Header;
