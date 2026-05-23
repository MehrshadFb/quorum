export const id = 729;
export const ids = [729];
export const modules = {

/***/ 7729:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   runImplementer: () => (/* binding */ runImplementer)
/* harmony export */ });
/* harmony import */ var _actions_core__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(7484);
/* harmony import */ var _actions_core__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_actions_core__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var node_child_process__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(1421);
/* harmony import */ var node_child_process__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(node_child_process__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var node_util__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(7975);
/* harmony import */ var node_util__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(node_util__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var _agents_util_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(812);
/* harmony import */ var _prompt_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(705);
/* harmony import */ var _deliberation_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(8066);






const exec = (0,node_util__WEBPACK_IMPORTED_MODULE_2__.promisify)(node_child_process__WEBPACK_IMPORTED_MODULE_1__.execFile);
/**
 * Runs the implementer agent with file-edit access, then commits + pushes
 * whatever files it changed. Returns true if a commit was pushed.
 */
async function runImplementer(input) {
    if (input.agent === 'grok') {
        _actions_core__WEBPACK_IMPORTED_MODULE_0__.warning('grok cannot be the implementer (no file-edit capability via API). Set deliberation_options.implementer to claude, codex, or gemini.');
        return false;
    }
    const prompt = (0,_prompt_js__WEBPACK_IMPORTED_MODULE_5__/* .renderImplementerPrompt */ .lh)({
        title: input.title,
        description: input.description,
        diff: input.diff,
        concerns: input.concernsBlock,
    });
    const opts = input.config.agents.options[input.agent] ?? {};
    try {
        if (input.agent === 'claude')
            await runClaudeImplementer(prompt, opts);
        else if (input.agent === 'codex')
            await runCodexImplementer(prompt, opts);
        else if (input.agent === 'gemini')
            await runGeminiImplementer(prompt, opts);
    }
    catch (err) {
        _actions_core__WEBPACK_IMPORTED_MODULE_0__.warning(`Implementer ${input.agent} failed: ${err.message}`);
        return false;
    }
    const { stdout: status } = await exec('git', ['status', '--porcelain']);
    if (!status.trim()) {
        _actions_core__WEBPACK_IMPORTED_MODULE_0__.warning(`Implementer ${input.agent} made no file changes`);
        return false;
    }
    _actions_core__WEBPACK_IMPORTED_MODULE_0__.info(`Implementer changed files:\n${status}`);
    await exec('git', ['config', 'user.name', _deliberation_js__WEBPACK_IMPORTED_MODULE_4__/* .QUORUM_BOT_NAME */ .y8]);
    await exec('git', ['config', 'user.email', _deliberation_js__WEBPACK_IMPORTED_MODULE_4__/* .QUORUM_BOT_EMAIL */ .Z8]);
    await exec('git', ['add', '-A']);
    await exec('git', [
        'commit',
        '-m',
        `quorum: round ${input.round} fixes (via ${input.agent})\n\nAddresses concerns raised by ${input.config.agents.required.join(', ')}.`,
    ]);
    try {
        await exec('git', ['push']);
        _actions_core__WEBPACK_IMPORTED_MODULE_0__.info('Pushed implementer fixes. The push will re-trigger Quorum.');
        return true;
    }
    catch (err) {
        _actions_core__WEBPACK_IMPORTED_MODULE_0__.error(`Failed to push fixes: ${err.message}`);
        _actions_core__WEBPACK_IMPORTED_MODULE_0__.error('The checkout token may lack push permission. Use a PAT in QUORUM_BOT_TOKEN with actions/checkout@v4 (token: ...).');
        return false;
    }
}
async function runClaudeImplementer(prompt, opts) {
    const args = [
        '-p',
        '--tools', 'Read,Edit,Write,Glob,Grep',
        '--output-format', 'text',
        '--allow-dangerously-skip-permissions',
        '--max-budget-usd', '10',
        '--permission-mode', 'auto',
    ];
    if (opts.model)
        args.push('--model', opts.model);
    await (0,_agents_util_js__WEBPACK_IMPORTED_MODULE_3__/* .spawnCapture */ .EO)({
        cmd: 'claude',
        args,
        stdin: prompt,
        timeoutMs: opts.timeout_ms ?? 600_000,
    });
}
async function runCodexImplementer(prompt, opts) {
    const args = [
        'exec',
        '--skip-git-repo-check',
        '--ephemeral',
        '--sandbox', 'workspace-write',
        '--color', 'never',
        '--full-auto',
    ];
    if (opts.model)
        args.push('--model', opts.model);
    args.push('-');
    await (0,_agents_util_js__WEBPACK_IMPORTED_MODULE_3__/* .spawnCapture */ .EO)({
        cmd: 'codex',
        args,
        stdin: prompt,
        timeoutMs: opts.timeout_ms ?? 600_000,
    });
}
async function runGeminiImplementer(prompt, opts) {
    // Gemini CLI's file-edit story varies by release. This is a best-effort
    // invocation; if your installed CLI rejects it, set options.gemini.model
    // and timeout_ms in config and report back.
    // --skip-trust: needed to run non-interactively outside the trust-list.
    const args = ['-p', '-', '--skip-trust'];
    if (opts.model)
        args.push('--model', opts.model);
    await (0,_agents_util_js__WEBPACK_IMPORTED_MODULE_3__/* .spawnCapture */ .EO)({
        cmd: 'gemini',
        args,
        stdin: prompt,
        timeoutMs: opts.timeout_ms ?? 600_000,
    });
}


/***/ })

};
