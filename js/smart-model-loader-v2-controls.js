function completeDecimal(event) {
    const input = event.currentTarget;
    if (input.type !== 'number' || input.disabled || input.readOnly) return;
    // Prefix a zero on commit without rounding or rewriting partial edits.
    const value = input.value.replace(/^(-?)\.(?=\d)/, (_match, sign) => `${sign}0.`);
    if (value !== input.value) input.value = value;
}
function selectValue(event) {
    if (event.type === 'click' && event.detail !== 3) return;
    const input = event.currentTarget;
    if (input.disabled || input.readOnly
        || !['text', 'search', 'url', 'tel', 'email', 'password', 'number', 'textarea'].includes(input.type)) return;
    event.stopPropagation();
    // Let the browser select the word under the pointer, using its own word boundaries.
    const numeric = input.type === 'number' || (input.type === 'text' && ['numeric', 'decimal'].includes(input.inputMode));
    if (event.type === 'dblclick' && !numeric) return;
    input.select();
    event.preventDefault();
}
export const element = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    if (tag === 'input' || tag === 'textarea') {
        node.addEventListener('dblclick', selectValue);
        node.addEventListener('click', selectValue);
    }
    if (tag === 'input') {
        node.addEventListener('change', completeDecimal);
        node.addEventListener('blur', completeDecimal);
    }
    return node;
};
