import {
	AbstractInputSuggest,
	App,
	FuzzySuggestModal,
	Keymap,
	MarkdownView,
	Menu,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	SettingDefinitionItem,
	TFile,
	TFolder,
	View,
	getLanguage,
	normalizePath,
	requireApiVersion,
} from "obsidian";

interface FolderEntry {
	path: string;
	alias: string;
}

interface QuickNewNoteSettings {
	folders: FolderEntry[];
	/** 菜单最上面加一项「当前文件夹」 */
	showCurrentFolder: boolean;
	/** 总在新标签页打开（否则跟原生一样：替换当前标签页，⌘/Ctrl 点击才开新标签页） */
	newTab: boolean;
}

const DEFAULT_SETTINGS: QuickNewNoteSettings = {
	folders: [],
	showCurrentFolder: true,
	newTab: false,
};

interface AppSetting {
	open(): void;
	openTabById(id: string): void;
}

/** Templater 不在公开 API 里，只取用到的几个方法，全部可选 */
interface TemplaterPlugin {
	settings?: {
		trigger_on_file_creation_mode?: string;
	};
	templater?: {
		create_new_note_from_template?: (
			template: TFile | string,
			folder?: TFolder | string,
			filename?: string,
			openNewNote?: boolean,
		) => Promise<TFile | undefined>;
		get_new_file_template_for_folder?: (folder: TFolder, extension?: string) => string | undefined;
	};
	editor_handler?: {
		jump_to_next_cursor_location?: (file: TFile, autoJump?: boolean) => Promise<void>;
	};
}

const ACTION_CLASS = "quick-new-note-action";

const STRINGS = {
	en: {
		newNoteIn: "New note in…",
		openMenuCommand: "Open new note menu",
		addFoldersHint: "Add folders in settings",
		currentFolder: (path: string) => `Current folder (${path})`,
		missing: (label: string) => `${label} (missing)`,
		otherFolder: "Other folder…",
		folderPickerPlaceholder: "Type a folder name to create the note in…",
		root: "/ (vault root)",
		untitled: "Untitled",
		failed: (msg: string) => `Could not create the note: ${msg}`,
		templaterFailed: "Templater did not create the note (see the Templater error above)",
		templateMissing: (path: string) => `Template not found: ${path}. Created a blank note instead.`,
		settingsIntro:
			"Folders listed in the \"New note in…\" menu at the top right of each note, in this order. Leave the alias empty to show the full path.",
		templatesIntro:
			"Templates come from Templater: a new note gets the folder template set for its folder (or the nearest parent folder) under Templater → Folder templates. Folders without one get a blank note.",
		templatesName: "Templates",
		pathPlaceholder: "Folder path",
		aliasPlaceholder: "Alias (optional)",
		noSuchFolder: "No such folder in this vault",
		up: "Move up",
		down: "Move down",
		remove: "Remove",
		addFolder: "+ Add folder",
		addFolderShort: "Add folder",
		listHeading: "Folders in the menu",
		introName: "How it works",
		emptyState: "No folders yet. Add the ones you create notes in most often.",
		newFolder: "New folder",
		optionsHeading: "Options",
		showCurrentName: "Show the current folder",
		showCurrentDesc: "Put the folder of the note you are on at the top of the menu.",
		newTabName: "Always open in a new tab",
		newTabDesc: "Off: like Obsidian's own new note, it opens in the current tab (Cmd/Ctrl-click for a new tab).",
		importName: "Import folders from Quick Move",
		importDesc: "Add the folders from Quick Move's \"Move to…\" menu that are not in this list yet.",
		importButton: "Import",
		imported: (n: number) => (n === 0 ? "Nothing new to import" : `Imported ${n} folder(s)`),
	},
	zh: {
		newNoteIn: "新建笔记到…",
		openMenuCommand: "打开新建笔记菜单",
		addFoldersHint: "去设置里添加文件夹",
		currentFolder: (path: string) => `当前文件夹（${path}）`,
		missing: (label: string) => `${label}（不存在）`,
		otherFolder: "其他文件夹…",
		folderPickerPlaceholder: "输入文件夹名称，在这里新建笔记…",
		root: "/（根目录）",
		untitled: "未命名",
		failed: (msg: string) => `新建笔记失败：${msg}`,
		templaterFailed: "Templater 没有建出笔记（看上面 Templater 的报错）",
		templateMissing: (path: string) => `找不到模板：${path}，已新建空白笔记`,
		settingsIntro: "笔记右上角「新建笔记到…」菜单里列出的文件夹，按这里的顺序显示。别名不填就显示完整路径。",
		templatesIntro:
			"模板直接用 Templater 的：新笔记套用 Templater 设置 →「Folder templates」里给这个文件夹（或最近的上级文件夹）配的模板，没配的就是空白笔记。",
		templatesName: "模板",
		pathPlaceholder: "文件夹路径",
		aliasPlaceholder: "别名（可不填）",
		noSuchFolder: "库里没有这个文件夹",
		up: "上移",
		down: "下移",
		remove: "删除",
		addFolder: "+ 添加文件夹",
		addFolderShort: "添加文件夹",
		listHeading: "菜单里的文件夹",
		introName: "说明",
		emptyState: "还没有文件夹。把最常新建笔记的几个加进来。",
		newFolder: "新文件夹",
		optionsHeading: "选项",
		showCurrentName: "显示当前文件夹",
		showCurrentDesc: "菜单最上面加一项：当前这篇笔记所在的文件夹。",
		newTabName: "总在新标签页打开",
		newTabDesc: "关闭时和原生「新建笔记」一样，在当前标签页打开（⌘/Ctrl 点击开新标签页）。",
		importName: "从 Quick Move 导入文件夹",
		importDesc: "把 Quick Move「移动到…」菜单里、这里还没有的文件夹加进来。",
		importButton: "导入",
		imported: (n: number) => (n === 0 ? "没有需要导入的文件夹" : `已导入 ${n} 个文件夹`),
	},
};

// 跟随 Obsidian 的界面语言
const t = getLanguage().startsWith("zh") ? STRINGS.zh : STRINGS.en;

/** "" / "/" 都表示库的根目录 */
function cleanFolderPath(path: string): string {
	const p = normalizePath(path.trim());
	return p === "" || p === "." ? "/" : p;
}

function joinPath(folder: string, name: string): string {
	return folder === "/" ? name : normalizePath(`${folder}/${name}`);
}

function enabledPlugins(app: App): Record<string, unknown> | undefined {
	return (app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins;
}

export default class QuickNewNotePlugin extends Plugin {
	settings: QuickNewNoteSettings = { ...DEFAULT_SETTINGS };
	private buttons = new WeakMap<View, HTMLElement>();

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new QuickNewNoteSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => this.addButtons());
		this.registerEvent(this.app.workspace.on("layout-change", () => this.addButtons()));

		// 没有打开任何笔记时，顶栏按钮不存在，侧边栏（手机上在菜单里）还有一个入口
		this.addRibbonIcon("file-plus", t.newNoteIn, (evt) => {
			this.buildMenu().showAtMouseEvent(evt);
		});

		this.addCommand({
			id: "open-new-note-menu",
			name: t.openMenuCommand,
			icon: "file-plus",
			callback: () => this.showMenu(this.app.workspace.getActiveViewOfType(MarkdownView)),
		});

		// 在文件列表里给文件夹改名时，快捷列表跟着改
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFolder) void this.onFolderRenamed(oldPath, file.path);
			}),
		);
	}

	onunload() {
		// 注入到原生顶栏的按钮不会随插件卸载自动消失，要自己收回（按 leaf 找，弹出窗口里的也能收到）
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			leaf.view.containerEl.querySelectorAll(`.${ACTION_CLASS}`).forEach((el) => el.remove());
		}
	}

	async loadSettings() {
		const data = (await this.loadData()) as Partial<QuickNewNoteSettings> | null;
		const folders = Array.isArray(data?.folders) ? data.folders : [];
		this.settings = {
			folders: folders.map((f) => ({
				path: typeof f.path === "string" ? f.path : "",
				alias: typeof f.alias === "string" ? f.alias : "",
			})),
			showCurrentFolder:
				typeof data?.showCurrentFolder === "boolean" ? data.showCurrentFolder : DEFAULT_SETTINGS.showCurrentFolder,
			newTab: typeof data?.newTab === "boolean" ? data.newTab : DEFAULT_SETTINGS.newTab,
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// ───────────── 按钮和菜单 ─────────────

	private addButtons() {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || this.buttons.has(view)) continue;
			const btn = view.addAction("file-plus", t.newNoteIn, () => this.showMenu(view));
			btn.addClass(ACTION_CLASS);
			this.buttons.set(view, btn);
		}
	}

	/** 按按钮的位置弹出（命令触发时没有鼠标坐标）；手机上 Menu 自己会变成底部弹出 */
	private showMenu(view: MarkdownView | null) {
		const menu = this.buildMenu();
		const btn = view ? this.buttons.get(view) : undefined;
		if (btn && btn.isShown()) {
			const r = btn.getBoundingClientRect();
			menu.showAtPosition({ x: r.right, y: r.bottom, width: r.width, overlap: true, left: true });
		} else {
			menu.showAtPosition({ x: window.innerWidth / 2, y: window.innerHeight / 3 });
		}
	}

	private buildMenu(): Menu {
		const menu = new Menu();
		const vault = this.app.vault;

		// 当前文件夹：取「最近活动的笔记」所在文件夹（从侧边栏点按钮时活动视图不是笔记）
		const activeFile = this.app.workspace.getActiveFile();
		if (this.settings.showCurrentFolder && activeFile?.parent) {
			const folder = activeFile.parent;
			const path = cleanFolderPath(folder.path);
			menu.addItem((item) =>
				item
					.setTitle(t.currentFolder(path === "/" ? t.root : path))
					.setIcon("folder-open")
					.onClick((evt) => void this.createIn(folder, evt)),
			);
			menu.addSeparator();
		}

		if (this.settings.folders.length === 0) {
			menu.addItem((item) =>
				item
					.setTitle(t.addFoldersHint)
					.setIcon("settings")
					.onClick(() => this.openSettings()),
			);
		}

		for (const entry of this.settings.folders) {
			const path = cleanFolderPath(entry.path);
			const folder = path === "/" ? vault.getRoot() : vault.getAbstractFileByPath(path);
			const label = entry.alias.trim() || path;
			menu.addItem((item) => {
				item.setIcon("folder");
				if (folder instanceof TFolder) {
					item.setTitle(label).onClick((evt) => void this.createIn(folder, evt));
				} else {
					item.setTitle(t.missing(label)).setDisabled(true);
				}
			});
		}

		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(t.otherFolder)
				.setIcon("folder-search")
				.onClick(() => new FolderPickerModal(this.app, (folder) => void this.createIn(folder, null)).open()),
		);
		return menu;
	}

	openSettings() {
		// 设置面板不在公开 API 里
		const setting = (this.app as unknown as { setting?: AppSetting }).setting;
		setting?.open();
		setting?.openTabById(this.manifest.id);
	}

	// ───────────── 新建 ─────────────

	private getTemplater(): TemplaterPlugin | null {
		const plugins = enabledPlugins(this.app) as Record<string, TemplaterPlugin | undefined> | undefined;
		return plugins?.["templater-obsidian"] ?? null;
	}

	/** Templater「Folder templates」里给这个文件夹（或最近的上级）配的模板路径 */
	private folderTemplatePath(folder: TFolder): string | null {
		const tp = this.getTemplater();
		if (tp?.settings?.trigger_on_file_creation_mode !== "folder") return null;
		const path = tp.templater?.get_new_file_template_for_folder?.(folder, "md");
		if (!path) return null;
		return normalizePath(path.endsWith(".md") ? path : `${path}.md`);
	}

	/** 「未命名」「未命名 1」「未命名 2」…，和原生新建笔记的命名一样 */
	private availableBasename(folder: TFolder): string {
		const dir = cleanFolderPath(folder.path);
		const vault = this.app.vault;
		let name = t.untitled;
		for (let i = 1; vault.getAbstractFileByPath(joinPath(dir, `${name}.md`)); i++) name = `${t.untitled} ${i}`;
		return name;
	}

	async createIn(folder: TFolder, evt: MouseEvent | KeyboardEvent | null) {
		const vault = this.app.vault;
		const templater = this.getTemplater();
		const templatePath = this.folderTemplatePath(folder);
		let file: TFile | undefined;
		let content = "";
		try {
			const basename = this.availableBasename(folder);
			if (templatePath) {
				const tpl = vault.getAbstractFileByPath(templatePath);
				if (tpl instanceof TFile) content = await vault.cachedRead(tpl);
				else new Notice(t.templateMissing(templatePath));
			}
			// Templater 开着「新建文件时触发」时，正文为空的笔记 300ms 后会被它再套一遍同一个文件夹模板；
			// 套的是同一个模板，属性合并后内容不变（实测「行动」这种只有属性的模板也一样），所以不用防
			const createFromTemplate = templater?.templater?.create_new_note_from_template;
			if (createFromTemplate) {
				// 交给 Templater 建：模板里的 <% %> 语法照常生效
				file = await createFromTemplate.call(templater.templater, content, folder, basename, false);
				if (!file) throw new Error(t.templaterFailed);
			} else {
				file = await vault.create(joinPath(cleanFolderPath(folder.path), `${basename}.md`), content);
			}
		} catch (e) {
			console.error("[quick-new-note]", e);
			new Notice(t.failed(e instanceof Error ? e.message : String(e)));
			return;
		}

		// 和原生新建笔记一样：编辑模式打开，选中标题等你输入名字
		const mod = evt ? Keymap.isModEvent(evt) : false;
		const leaf = this.app.workspace.getLeaf(this.settings.newTab ? "tab" : mod);
		const hasCursor = content.includes("tp.file.cursor");
		await leaf.openFile(file, {
			active: true,
			state: { mode: "source" },
			eState: hasCursor ? undefined : { rename: "all" },
		});
		if (hasCursor) await templater?.editor_handler?.jump_to_next_cursor_location?.(file, true);
	}

	// ───────────── 设置相关 ─────────────

	private async onFolderRenamed(oldPath: string, newPath: string) {
		let changed = false;
		for (const entry of this.settings.folders) {
			const p = cleanFolderPath(entry.path);
			if (p === oldPath) {
				entry.path = newPath;
				changed = true;
			} else if (p.startsWith(oldPath + "/")) {
				entry.path = newPath + p.slice(oldPath.length);
				changed = true;
			}
		}
		if (changed) await this.saveSettings();
	}

	/** Quick Move 开着时，把它的文件夹列表里这边还没有的加进来 */
	async importFromQuickMove(): Promise<number> {
		const qm = enabledPlugins(this.app)?.["quick-move"] as
			| { settings?: { folders?: { path?: unknown; alias?: unknown }[] } }
			| undefined;
		const list = qm?.settings?.folders ?? [];
		const have = new Set(this.settings.folders.map((e) => cleanFolderPath(e.path)));
		let n = 0;
		for (const f of list) {
			if (typeof f.path !== "string" || f.path.trim() === "") continue;
			const p = cleanFolderPath(f.path);
			if (have.has(p)) continue;
			have.add(p);
			this.settings.folders.push({ path: f.path, alias: typeof f.alias === "string" ? f.alias : "" });
			n++;
		}
		if (n > 0) await this.saveSettings();
		return n;
	}

	hasQuickMove(): boolean {
		return !!enabledPlugins(this.app)?.["quick-move"];
	}
}

class FolderPickerModal extends FuzzySuggestModal<TFolder> {
	constructor(
		app: App,
		private onChoose: (folder: TFolder) => void,
	) {
		super(app);
		this.setPlaceholder(t.folderPickerPlaceholder);
	}

	getItems(): TFolder[] {
		return this.app.vault.getAllFolders(true);
	}

	getItemText(folder: TFolder): string {
		return folder.isRoot() ? t.root : folder.path;
	}

	onChooseItem(folder: TFolder) {
		this.onChoose(folder);
	}
}

class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(
		app: App,
		private inputEl: HTMLInputElement,
	) {
		super(app, inputEl);
	}

	getSuggestions(query: string): TFolder[] {
		const q = query.toLowerCase();
		return this.app.vault
			.getAllFolders(true)
			.filter((f) => f.path.toLowerCase().includes(q))
			.sort((a, b) => a.path.localeCompare(b.path))
			.slice(0, 50);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement) {
		el.setText(folder.isRoot() ? t.root : folder.path);
	}

	selectSuggestion(folder: TFolder) {
		this.setValue(folder.path);
		this.inputEl.dispatchEvent(new Event("input"));
		this.close();
	}
}

class QuickNewNoteSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: QuickNewNotePlugin,
	) {
		super(app, plugin);
	}

	/** 1.13+ 的声明式设置页：能被设置面板搜索到；控件都自己画，不走 setControlValue（它会整体覆盖 data.json） */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const folders = this.plugin.settings.folders;
		return [
			{ name: t.introName, desc: t.settingsIntro },
			{ name: t.templatesName, desc: t.templatesIntro },
			{
				type: "list",
				heading: t.listHeading,
				emptyState: t.emptyState,
				addItem: { name: t.addFolderShort, action: () => void this.addFolder() },
				onDelete: (i) => void this.removeFolder(i),
				items: folders.map((entry, i) => ({
					name: entry.alias.trim() || entry.path || t.newFolder,
					aliases: [entry.path],
					render: (setting: Setting) => this.renderRow(setting, i, false),
				})),
			},
			{
				type: "group",
				heading: t.optionsHeading,
				items: [
					{
						name: t.showCurrentName,
						desc: t.showCurrentDesc,
						render: (setting: Setting) => this.renderToggle(setting, "showCurrentFolder"),
					},
					{
						name: t.newTabName,
						desc: t.newTabDesc,
						render: (setting: Setting) => this.renderToggle(setting, "newTab"),
					},
					{
						name: t.importName,
						desc: t.importDesc,
						visible: () => this.plugin.hasQuickMove(),
						render: (setting: Setting) => this.renderImport(setting),
					},
				],
			},
		];
	}

	/** 1.13 之前的版本走这里 */
	display() {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("p", { text: t.settingsIntro, cls: "setting-item-description" });
		containerEl.createEl("p", { text: t.templatesIntro, cls: "setting-item-description" });
		this.plugin.settings.folders.forEach((_, i) => this.renderRow(new Setting(containerEl), i, true));
		new Setting(containerEl).addButton((b) => b.setButtonText(t.addFolder).onClick(() => void this.addFolder()));

		new Setting(containerEl).setName(t.optionsHeading).setHeading();
		this.renderToggle(
			new Setting(containerEl).setName(t.showCurrentName).setDesc(t.showCurrentDesc),
			"showCurrentFolder",
		);
		this.renderToggle(new Setting(containerEl).setName(t.newTabName).setDesc(t.newTabDesc), "newTab");
		if (this.plugin.hasQuickMove()) {
			this.renderImport(new Setting(containerEl).setName(t.importName).setDesc(t.importDesc));
		}
	}

	private refresh() {
		if (requireApiVersion("1.13.0")) this.update();
		else this.display();
	}

	private renderRow(setting: Setting, i: number, withRemove: boolean) {
		const folders = this.plugin.settings.folders;
		const entry = folders[i];
		setting.setClass("quick-new-note-row");
		setting.infoEl.hide();

		setting.addText((text) => {
			text.setPlaceholder(t.pathPlaceholder).setValue(entry.path);
			text.inputEl.addClass("quick-new-note-path");
			new FolderSuggest(this.app, text.inputEl);
			const validate = () => {
				const p = cleanFolderPath(text.getValue());
				const ok =
					text.getValue().trim() !== "" &&
					(p === "/" || this.app.vault.getAbstractFileByPath(p) instanceof TFolder);
				text.inputEl.toggleClass("quick-new-note-invalid", !ok);
				text.inputEl.title = ok ? "" : t.noSuchFolder;
			};
			validate();
			text.onChange(async (value) => {
				entry.path = value.trim();
				validate();
				await this.plugin.saveSettings();
			});
		});

		setting.addText((text) => {
			text.setPlaceholder(t.aliasPlaceholder).setValue(entry.alias);
			text.inputEl.addClass("quick-new-note-alias");
			text.onChange(async (value) => {
				entry.alias = value;
				await this.plugin.saveSettings();
			});
		});

		setting.addExtraButton((b) =>
			b
				.setIcon("arrow-up")
				.setTooltip(t.up)
				.setDisabled(i === 0)
				.onClick(() => void this.swap(i, i - 1)),
		);
		setting.addExtraButton((b) =>
			b
				.setIcon("arrow-down")
				.setTooltip(t.down)
				.setDisabled(i === folders.length - 1)
				.onClick(() => void this.swap(i, i + 1)),
		);
		if (withRemove) {
			setting.addExtraButton((b) =>
				b
					.setIcon("x")
					.setTooltip(t.remove)
					.onClick(() => void this.removeFolder(i)),
			);
		}
	}

	private renderToggle(setting: Setting, key: "showCurrentFolder" | "newTab") {
		const s = this.plugin.settings;
		setting.addToggle((tg) =>
			tg.setValue(s[key]).onChange(async (value) => {
				s[key] = value;
				await this.plugin.saveSettings();
			}),
		);
	}

	private renderImport(setting: Setting) {
		setting.addButton((b) =>
			b.setButtonText(t.importButton).onClick(async () => {
				const n = await this.plugin.importFromQuickMove();
				new Notice(t.imported(n));
				this.refresh();
			}),
		);
	}

	private async addFolder() {
		this.plugin.settings.folders.push({ path: "", alias: "" });
		await this.plugin.saveSettings();
		this.refresh();
		const inputs = this.containerEl.querySelectorAll<HTMLInputElement>(".quick-new-note-path");
		inputs[inputs.length - 1]?.focus();
	}

	private async removeFolder(i: number) {
		this.plugin.settings.folders.splice(i, 1);
		await this.plugin.saveSettings();
		this.refresh();
	}

	private async swap(a: number, b: number) {
		const folders = this.plugin.settings.folders;
		if (b < 0 || b >= folders.length) return;
		[folders[a], folders[b]] = [folders[b], folders[a]];
		await this.plugin.saveSettings();
		this.refresh();
	}
}
