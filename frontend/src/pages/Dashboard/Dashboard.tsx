import React from 'react';
import { useAuth } from '../../contexts/AuthContext';

const Dashboard: React.FC = () => {
  const { user } = useAuth();

  const stats = [
    {
      title: 'Total Employees',
      value: '142',
      icon: 'bi-people',
      color: 'primary',
      change: '+5%',
      changeType: 'positive',
    },
    {
      title: 'Active Schedules',
      value: '8',
      icon: 'bi-calendar3',
      color: 'success',
      change: '+2%',
      changeType: 'positive',
    },
    {
      title: 'Today\'s Shifts',
      value: '24',
      icon: 'bi-clock',
      color: 'info',
      change: '0%',
      changeType: 'neutral',
    },
    {
      title: 'Pending Approvals',
      value: '6',
      icon: 'bi-exclamation-triangle',
      color: 'warning',
      change: '-12%',
      changeType: 'positive',
    },
  ];

  const recentActivities = [
    {
      id: 1,
      type: 'shift_assigned',
      message: 'John Doe assigned to Morning Shift',
      time: '2 hours ago',
      icon: 'bi-plus-circle',
      color: 'success',
    },
    {
      id: 2,
      type: 'schedule_published',
      message: 'Weekly Schedule published for Week 45',
      time: '4 hours ago',
      icon: 'bi-calendar-check',
      color: 'primary',
    },
    {
      id: 3,
      type: 'employee_added',
      message: 'New employee Sarah Johnson added',
      time: '1 day ago',
      icon: 'bi-person-plus',
      color: 'info',
    },
    {
      id: 4,
      type: 'shift_cancelled',
      message: 'Evening Shift cancelled due to low demand',
      time: '2 days ago',
      icon: 'bi-x-circle',
      color: 'danger',
    },
  ];

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h1 className="h3 mb-0">Dashboard</h1>
          <p className="text-muted">Welcome back, {user?.firstName}!</p>
        </div>
        <div>
          <button className="btn btn-primary">
            <i className="bi bi-plus-lg me-2"></i>
            Quick Action
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="row mb-4">
        {stats.map((stat, index) => (
          <div key={index} className="col-lg-3 col-md-6 mb-3">
            <div className="card h-100">
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-start">
                  <div>
                    <h6 className="card-title text-muted mb-2">{stat.title}</h6>
                    <h3 className="mb-0">{stat.value}</h3>
                    <small className={`text-${stat.changeType === 'positive' ? 'success' : stat.changeType === 'negative' ? 'danger' : 'muted'}`}>
                      {stat.change} from last month
                    </small>
                  </div>
                  <div className={`bg-${stat.color} bg-opacity-10 p-3 rounded`}>
                    <i className={`${stat.icon} text-${stat.color}`} style={{ fontSize: '1.5rem' }}></i>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="row">
        {/* Recent Activities */}
        <div className="col-lg-8 mb-4">
          <div className="card h-100">
            <div className="card-header">
              <h5 className="mb-0">Recent Activities</h5>
            </div>
            <div className="card-body">
              <div className="list-group list-group-flush">
                {recentActivities.map((activity) => (
                  <div key={activity.id} className="list-group-item d-flex align-items-center">
                    <div className={`bg-${activity.color} bg-opacity-10 p-2 rounded me-3`}>
                      <i className={`${activity.icon} text-${activity.color}`}></i>
                    </div>
                    <div className="flex-grow-1">
                      <div className="fw-medium">{activity.message}</div>
                      <small className="text-muted">{activity.time}</small>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Quick Links */}
        <div className="col-lg-4 mb-4">
          <div className="card h-100">
            <div className="card-header">
              <h5 className="mb-0">Quick Links</h5>
            </div>
            <div className="card-body">
              <div className="d-grid gap-2">
                <a href="/employees" className="btn btn-outline-primary text-start">
                  <i className="bi bi-people me-2"></i>
                  Manage Employees
                </a>
                <a href="/schedule" className="btn btn-outline-success text-start">
                  <i className="bi bi-calendar3 me-2"></i>
                  View Schedule
                </a>
                <a href="/shifts" className="btn btn-outline-info text-start">
                  <i className="bi bi-clock me-2"></i>
                  Manage Shifts
                </a>
                <a href="/reports" className="btn btn-outline-warning text-start">
                  <i className="bi bi-graph-up me-2"></i>
                  Generate Reports
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Chart placeholder */}
      <div className="row">
        <div className="col-12">
          <div className="card">
            <div className="card-header">
              <h5 className="mb-0">Weekly Hours Overview</h5>
            </div>
            <div className="card-body">
              <div className="text-center py-5">
                <i className="bi bi-bar-chart text-muted" style={{ fontSize: '3rem' }}></i>
                <p className="text-muted mt-2">Chart will be implemented with React Charts</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
