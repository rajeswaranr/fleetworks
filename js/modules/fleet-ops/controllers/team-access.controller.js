/**
 * Team Access Controller
 * Manages user roles, permissions, and access control
 */

let teamData = {
  members: [],
  roles: {},
  stats: { total: 0, admin: 0, supervisor: 0, driver: 0, mechanic: 0 }
};

async function initTeam() {
  console.log('Initializing Team Access Management...');
  try {
    if (!window.supabaseUser) return;

    const { data: members } = await window.supabase
      .from('team_members')
      .select('*, role_permissions(*)')
      .eq('org_id', window.supabaseUser.org_id)
      .order('name');

    teamData.members = members || [];
    calculateTeamStats();
    renderTeam();
  } catch (error) {
    console.error('Team access error:', error);
  }
}

function calculateTeamStats() {
  teamData.stats = {
    total: teamData.members.length,
    admin: teamData.members.filter(m => m.role === 'admin').length,
    supervisor: teamData.members.filter(m => m.role === 'supervisor').length,
    driver: teamData.members.filter(m => m.role === 'driver').length,
    mechanic: teamData.members.filter(m => m.role === 'mechanic').length
  };
}

function renderTeam() {
  const container = document.querySelector('#tab-team') || document.getElementById('teamContainer');
  if (!container) return;

  const stats = teamData.stats;
  const roleColors = {
    admin: '#ef4444',
    supervisor: '#3b82f6',
    driver: '#f59e0b',
    mechanic: '#10b981'
  };

  let html = `
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px">
      <div style="padding:12px;background:var(--surface-2);border-radius:6px;text-align:center">
        <div style="font-size:2rem;font-weight:bold">${stats.total}</div>
        <div style="font-size:0.85rem;color:var(--text-muted)">Team Members</div>
      </div>
      <div style="padding:12px;background:var(--surface-2);border-radius:6px;text-align:center">
        <div style="font-size:2rem;font-weight:bold;color:#ef4444">${stats.admin}</div>
        <div style="font-size:0.85rem;color:var(--text-muted)">Admin</div>
      </div>
      <div style="padding:12px;background:var(--surface-2);border-radius:6px;text-align:center">
        <div style="font-size:2rem;font-weight:bold;color:#3b82f6">${stats.supervisor}</div>
        <div style="font-size:0.85rem;color:var(--text-muted)">Supervisor</div>
      </div>
      <div style="padding:12px;background:var(--surface-2);border-radius:6px;text-align:center">
        <div style="font-size:2rem;font-weight:bold;color:#f59e0b">${stats.driver}</div>
        <div style="font-size:0.85rem;color:var(--text-muted)">Driver</div>
      </div>
      <div style="padding:12px;background:var(--surface-2);border-radius:6px;text-align:center">
        <div style="font-size:2rem;font-weight:bold;color:#10b981">${stats.mechanic}</div>
        <div style="font-size:0.85rem;color:var(--text-muted)">Mechanic</div>
      </div>
    </div>
  `;

  // Team members list with permissions
  html += teamData.members.map(m => {
    const roleColor = roleColors[m.role] || '#666';
    const permissions = m.role_permissions?.length > 0
      ? m.role_permissions.map(p => p.permission).join(', ')
      : 'No permissions assigned';

    return `
      <div style="padding:12px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
          <div>
            <div style="font-weight:600">${m.name}</div>
            <div style="font-size:0.85rem;color:var(--text-muted)">${m.email || 'No email'}</div>
          </div>
          <div style="padding:4px 12px;background:${roleColor}20;color:${roleColor};border-radius:4px;font-size:0.85rem;font-weight:bold">${m.role?.toUpperCase()}</div>
        </div>
        <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:6px">
          <strong>Permissions:</strong> ${permissions}
        </div>
        <div style="font-size:0.8rem;color:var(--text-muted)">
          Status: <span style="font-weight:600;color:${m.status === 'active' ? '#10b981' : '#ef4444'}">${m.status?.toUpperCase()}</span> •
          Last Active: ${m.last_active ? new Date(m.last_active).toLocaleDateString('en-IN') : 'Never'}
        </div>
      </div>
    `;
  }).join('') || '<div style="text-align:center;padding:20px;color:var(--text-muted)">No team members</div>';

  container.innerHTML = html;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(initTeam, 100));
} else {
  setTimeout(initTeam, 100);
}
