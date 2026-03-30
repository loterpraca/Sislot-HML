/**
 * SISLOT - Utilitários Compartilhados (Versão robusta)
 */

(function() {
    'use strict';

    // =====================================================
    // DOM HELPERS
    // =====================================================
    function $(id) {
    return document.getElementById(id);
    }

    function $q(selector, ctx = document) {
    return ctx.querySelector(selector);
    }

    function $qa(selector, ctx = document) {
    return Array.from(ctx.querySelectorAll(selector));
    }

    const $$ = $qa;

    // =====================================================
    // FORMATAÇÃO
    // =====================================================
    function parseCota(v) {
        if (!v) return 0;
        const s = String(v).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
        return parseFloat(s) || 0;
    }

    function fmtBR(v) {
        return parseFloat(v || 0).toLocaleString('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function fmtBRL(v) {
        return parseFloat(v || 0).toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        });
    }

    // Função de formatação de data mais robusta
    // =====================================================
    // FORMATAÇÃO DE DATA - VERSÃO SUPER DEFENSIVA
    // =====================================================

    function fmtData(data) {
        // Se for null, undefined ou vazio
        if (!data) return '—';

        let dia, mes, ano;

        // CASO 1: Já é um objeto Date
        if (data instanceof Date && !isNaN(data.getTime())) {
            dia = data.getDate();
            mes = data.getMonth() + 1;
            ano = data.getFullYear();
        }

        // CASO 2: É uma string
        else if (typeof data === 'string') {
            // Tenta extrair padrão YYYY-MM-DD
            let match = data.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (match) {
                ano = parseInt(match[1]);
                mes = parseInt(match[2]);
                dia = parseInt(match[3]);
            }
            // Tenta extrair padrão DD/MM/YYYY
            else {
                match = data.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                if (match) {
                    dia = parseInt(match[1]);
                    mes = parseInt(match[2]);
                    ano = parseInt(match[3]);
                }
                // Último recurso: tenta converter para Date
                else {
                    const d = new Date(data);
                    if (!isNaN(d.getTime())) {
                        dia = d.getDate();
                        mes = d.getMonth() + 1;
                        ano = d.getFullYear();
                    }
                }
            }
        }

        // CASO 3: É número (timestamp)
        else if (typeof data === 'number' && !isNaN(data)) {
            const d = new Date(data);
            if (!isNaN(d.getTime())) {
                dia = d.getDate();
                mes = d.getMonth() + 1;
                ano = d.getFullYear();
            }
        }

        // Se conseguiu extrair os valores
        if (dia && mes && ano) {
            return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`;
        }

        // Fallback: retorna o que recebeu (ou '—' se for inválido)
        return data && data !== '[object Object]' ? String(data) : '—';
    }

    function fmtDataInput(date) {
        if (!date) return '';
        const d = date instanceof Date ? date : new Date(date);
        if (isNaN(d.getTime())) return '';
        return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
    }

    function isoDate(date) {
        if (!date) return '';
        const d = date instanceof Date ? date : new Date(date);
        if (isNaN(d.getTime())) return '';
        return d.toISOString().slice(0, 10);
    }

    function getDataAtual() {
        return isoDate(new Date());
    }

    function addDias(inputId, delta) {
        const el = $(inputId);
        if (!el) return;

        const v = el.value;
        let y, m, d;

        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
            [y, m, d] = v.split('-').map(Number);
        } else {
            const n = new Date();
            y = n.getFullYear();
            m = n.getMonth() + 1;
            d = n.getDate();
        }

        const dt = new Date(y, m - 1, d);
        dt.setDate(dt.getDate() + delta);
        el.value = fmtDataInput(dt);
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // =====================================================
    // UI HELPERS
    // =====================================================
    function setStatus(elOrId, msg, tipo = 'ok', icone = null) {
        const el = typeof elOrId === 'string' ? $(elOrId) : elOrId;
        if (!el) return;

        const tipoClass = {
            'ok': 'ok', 'err': 'err', 'error': 'err',
 'warn': 'warn', 'warning': 'warn', 'muted': 'ok',
 'success': 'ok', 'danger': 'err'
        }[tipo] || 'ok';

        el.className = `status-bar show ${tipoClass}`;
        el.textContent = msg;
    }

    function showStatus(id, msg, tipo = 'ok') {
        const el = $(id);
        if (!el) return;
        el.textContent = msg;
        el.className = `status-chip show ${tipo}`;
    }

    function hideStatus(id) {
        const el = $(id);
        if (el) el.className = 'status-bar';
    }

    function setBtnLoading(btnOrId, on) {
        const btn = typeof btnOrId === 'string' ? $(btnOrId) : btnOrId;
        if (!btn) return;

        if (on) {
            btn._originalText = btn.innerHTML;
            btn.disabled = true;
            btn.classList.add('btn-loading');
        } else {
            btn.disabled = false;
            btn.classList.remove('btn-loading');
            if (btn._originalText) {
                btn.innerHTML = btn._originalText;
                delete btn._originalText;
            }
        }
    }

    function showModal({ title, body, onConfirm = null, onCancel = null }) {
        const result = confirm(`${title}\n\n${body}`);
        if (result && onConfirm) onConfirm();
        if (!result && onCancel) onCancel();
    }

    function showToast(message, type = 'info', duration = 3000) {
        let container = $('#toastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toastContainer';
            container.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 10px;
            `;
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        const colors = {
            success: 'rgba(0,200,150,0.95)',
 error: 'rgba(255,82,82,0.95)',
 warning: 'rgba(245,166,35,0.95)',
 info: 'rgba(56,189,248,0.95)'
        };

        toast.style.cssText = `
        background: ${colors[type] || colors.info};
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
        opacity: 0;
        transition: opacity 0.3s;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        `;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => toast.style.opacity = '1', 10);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, duration);

        toast.onclick = () => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        };
    }

    function updateClock(elementId = 'relogio') {
        const el = $(elementId);
        if (!el) return;
        const now = new Date();
        el.textContent = now.toLocaleTimeString('pt-BR') + ' — ' +
        now.toLocaleDateString('pt-BR', {
            weekday: 'short',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    }

    function startClock(elementId = 'relogio') {
        updateClock(elementId);
        setInterval(() => updateClock(elementId), 1000);
    }

    // =====================================================
    // SELECT HELPERS
    // =====================================================
    function fillSelect(selectId, items, placeholder = 'Selecione...', valueKey = 'id', labelFn = (x) => x.nome) {
        const sel = $(selectId);
        if (!sel) return;

        const current = sel.value;
        sel.innerHTML = `<option value="">${placeholder}</option>`;

        items.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item[valueKey];
            opt.textContent = labelFn(item);
            sel.appendChild(opt);
        });

        if ([...sel.options].some(o => o.value === current)) {
            sel.value = current;
        }
    }

    // =====================================================
    // VALIDAÇÕES
    // =====================================================
    function validarCPF(cpf) {
        cpf = String(cpf).replace(/[^\d]/g, '');
        if (cpf.length !== 11) return false;
        if (/^(\d)\1{10}$/.test(cpf)) return false;

        let soma = 0;
        let resto;
        for (let i = 1; i <= 9; i++) {
            soma += parseInt(cpf.substring(i - 1, i)) * (11 - i);
        }
        resto = (soma * 10) % 11;
        if (resto === 10 || resto === 11) resto = 0;
        if (resto !== parseInt(cpf.substring(9, 10))) return false;

        soma = 0;
        for (let i = 1; i <= 10; i++) {
            soma += parseInt(cpf.substring(i - 1, i)) * (12 - i);
        }
        resto = (soma * 10) % 11;
        if (resto === 10 || resto === 11) resto = 0;
        return resto === parseInt(cpf.substring(10, 11));
    }

    function validarCNPJ(cnpj) {
        cnpj = String(cnpj).replace(/[^\d]/g, '');
        if (cnpj.length !== 14) return false;
        if (/^(\d)\1{13}$/.test(cnpj)) return false;

        let tamanho = 12;
        let numeros = cnpj.substring(0, tamanho);
        const digitos = cnpj.substring(tamanho);
        let soma = 0;
        let pos = tamanho - 7;

        for (let i = tamanho; i >= 1; i--) {
            soma += parseInt(numeros.charAt(tamanho - i)) * pos--;
            if (pos < 2) pos = 9;
        }

        let resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
        if (resultado !== parseInt(digitos.charAt(0))) return false;

        tamanho = 13;
        numeros = cnpj.substring(0, tamanho);
        soma = 0;
        pos = tamanho - 7;

        for (let i = tamanho; i >= 1; i--) {
            soma += parseInt(numeros.charAt(tamanho - i)) * pos--;
            if (pos < 2) pos = 9;
        }

        resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
        return resultado === parseInt(digitos.charAt(1));
    }

    function validarEmail(email) {
        const re = /^[^\s@]+@([^\s@]+\.)+[^\s@]+$/;
        return re.test(email);
    }

    // =====================================================
    // API HELPERS
    // =====================================================
    async function apiRequest(url, options = {}) {
        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('API Error:', error);
            showToast('Erro na comunicação com o servidor', 'error');
            throw error;
        }
    }

    // =====================================================
    // EXPORT
    // =====================================================
   const SISLOT_UTILS = {
    $, $q, $qa, $$,
    parseCota, fmtBR, fmtBRL, fmtData, fmtDataInput, isoDate, getDataAtual, addDias,
    setStatus, showStatus, hideStatus, setBtnLoading, showModal, showToast, updateClock, startClock,
    fillSelect,
    validarCPF, validarCNPJ, validarEmail,
    apiRequest
};

    // Aliases para compatibilidade
    if (typeof window.fmtMoney === 'undefined') window.fmtMoney = SISLOT_UTILS.fmtBRL;
    if (typeof window.fmtDate === 'undefined') window.fmtDate = SISLOT_UTILS.fmtData;
    if (typeof window.showStatus === 'undefined') window.showStatus = SISLOT_UTILS.showStatus;
    if (typeof window.hideStatus === 'undefined') window.hideStatus = SISLOT_UTILS.hideStatus;
    if (typeof window.setBtnLoading === 'undefined') window.setBtnLoading = SISLOT_UTILS.setBtnLoading;
    if (typeof window.updateClock === 'undefined') window.updateClock = SISLOT_UTILS.updateClock;
    if (typeof window.parseCota === 'undefined') window.parseCota = SISLOT_UTILS.parseCota;
    if (typeof window.addDias === 'undefined') window.addDias = SISLOT_UTILS.addDias;

    window.SISLOT_UTILS = SISLOT_UTILS;
    console.log('✓ SISLOT_UTILS carregado (versão robusta)');
})();
