async function loadDevices(){
    const tableBody = document.querySelector('#devicesTable tbody');
    tableBody.innerHTML = '<tr><td colspan="8">Loading...</td></tr>';
    try{
        const res = await fetch('/api/v1/devices');
        const data = await res.json();
        const devices = data.devices || [];
        if(devices.length === 0){
            tableBody.innerHTML = '<tr><td colspan="8">No devices</td></tr>';
            return;
        }
        tableBody.innerHTML = devices.map(d => `
            <tr>
                <td style="font-family:monospace;">${d.id}</td>
                <td>${d.name||''}</td>
                <td>${d.location||''}</td>
                <td>${d.model||''}</td>
                <td>${d.firmware||''}</td>
                <td>${d.last_seen||''}</td>
                <td>${d.active? 'Yes' : 'No'}</td>
                <td>
                    ${d.active? `<button data-action="revokeDevice" data-id="${d.id}">Revoke</button>` : `<button data-action="activateDevice" data-id="${d.id}">Activate</button>`}
                </td>
            </tr>
        `).join('');
    }catch(e){
        tableBody.innerHTML = '<tr><td colspan="8">Error loading devices</td></tr>';
    }
}

async function registerDevice(){
    const name = document.getElementById('devName').value || 'device';
    const location = document.getElementById('devLocation').value || '';
    const model = document.getElementById('devModel').value || '';
    const firmware = document.getElementById('devFirmware').value || '';
    const adminKey = document.getElementById('adminKey').value || '';
    const headers = {'Content-Type': 'application/json'};
    if(adminKey) headers['X-Admin-Key'] = adminKey;
    const body = {name, location, model, firmware};
    try{
        const res = await fetch('/api/v1/devices/register', {method: 'POST', headers, body: JSON.stringify(body)});
        const data = await res.json();
        if(res.status === 201){
            document.getElementById('registerResult').textContent = `Created device ${data.device_id}. Token: ${data.token} (store securely)`;
            document.getElementById('devName').value=''; document.getElementById('devLocation').value=''; document.getElementById('devModel').value=''; document.getElementById('devFirmware').value='';
            loadDevices();
        }else{
            document.getElementById('registerResult').textContent = data.message || 'Error registering';
            document.getElementById('registerResult').style.color='red';
        }
    }catch(e){
        document.getElementById('registerResult').textContent = 'Error registering device';
        document.getElementById('registerResult').style.color='red';
    }
}

async function revokeDevice(id){
    const adminKey = document.getElementById('adminKey').value || '';
    if(!confirm('Revoke device '+id+'?')) return;
    const headers = {};
    if(adminKey) headers['X-Admin-Key'] = adminKey;
    try{
        const res = await fetch(`/api/v1/devices/${id}/revoke`, {method: 'POST', headers});
        if(res.ok){ loadDevices(); }
        else alert('Failed to revoke (check admin key)');
    }catch(e){ alert('Failed to revoke'); }
}

async function activateDevice(id){
    const adminKey = document.getElementById('adminKey').value || '';
    if(!confirm('Activate device '+id+'?')) return;
    const headers = {};
    if(adminKey) headers['X-Admin-Key'] = adminKey;
    try{
        const res = await fetch(`/api/v1/devices/${id}/activate`, {method: 'POST', headers});
        if(res.ok){ loadDevices(); }
        else alert('Failed to activate (check admin key)');
    }catch(e){ alert('Failed to activate'); }
}

// Auto-load on page open
// Delegate clicks for dynamically generated device action buttons
document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (action === 'revokeDevice') revokeDevice(id);
    if (action === 'activateDevice') activateDevice(id);
});

window.addEventListener('load', ()=>{ if(window.location.pathname === '/devices') loadDevices(); });
