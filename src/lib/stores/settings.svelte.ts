import { browser } from '$app/environment';
import { CONFIG_LOCALSTORAGE_KEY, SETTING_CONFIG_DEFAULT } from '$lib/constants';

const THEME_LOCALSTORAGE_KEY = 'theme';

class SettingsStore {
	config = $state<SettingsConfigType>({ ...SETTING_CONFIG_DEFAULT });
	theme = $state<string>(String(SETTING_CONFIG_DEFAULT.theme ?? 'system'));
	isInitialized = $state(false);
	userOverrides = $state<Set<string>>(new Set());

	constructor() {
		if (browser) {
			this.initialize();
		}
	}

	initialize(): void {
		if (this.isInitialized || !browser) return;

		try {
			const rawConfig = localStorage.getItem(CONFIG_LOCALSTORAGE_KEY);
			const parsedConfig = rawConfig ? JSON.parse(rawConfig) : {};
			this.config = {
				...SETTING_CONFIG_DEFAULT,
				...parsedConfig
			};
		} catch {
			this.config = { ...SETTING_CONFIG_DEFAULT };
		}

		this.theme = localStorage.getItem(THEME_LOCALSTORAGE_KEY) ?? String(this.config.theme);
		this.isInitialized = true;
	}

	private persist(): void {
		if (!browser) return;
		localStorage.setItem(CONFIG_LOCALSTORAGE_KEY, JSON.stringify(this.config));
		localStorage.setItem(THEME_LOCALSTORAGE_KEY, this.theme);
	}

	updateConfig<K extends keyof SettingsConfigType>(key: K, value: SettingsConfigType[K]): void {
		this.config[key] = value;
		if (key === 'theme') {
			this.theme = String(value);
		}
		this.userOverrides = new Set([...this.userOverrides, String(key)]);
		this.persist();
	}

	updateMultipleConfig(updates: Partial<SettingsConfigType>): void {
		this.config = {
			...this.config,
			...updates
		};

		if ('theme' in updates && updates.theme) {
			this.theme = String(updates.theme);
		}

		this.userOverrides = new Set([
			...this.userOverrides,
			...Object.keys(updates).map((key) => String(key))
		]);
		this.persist();
	}

	updateTheme(theme: string): void {
		this.theme = theme;
		this.config.theme = theme;
		this.persist();
	}

	resetParameterToServerDefault(key: string): void {
		const resolvedKey = key;
		(this.config as Record<string, SettingsConfigValue>)[resolvedKey] = SETTING_CONFIG_DEFAULT[
			resolvedKey
		];
		const nextOverrides = new Set(this.userOverrides);
		nextOverrides.delete(resolvedKey);
		this.userOverrides = nextOverrides;
		this.persist();
	}

	syncWithServerDefaults(): void {
		const nextOverrides = new Set<string>();

		for (const key of this.userOverrides) {
			const currentValue = (this.config as Record<string, SettingsConfigValue>)[key];
			const defaultValue = (SETTING_CONFIG_DEFAULT as Record<string, SettingsConfigValue>)[key];

			if (currentValue !== defaultValue) {
				nextOverrides.add(key);
			}
		}

		this.userOverrides = nextOverrides;
		this.persist();
	}

	forceSyncWithServerDefaults(): void {
		this.config = { ...SETTING_CONFIG_DEFAULT };
		this.theme = String(SETTING_CONFIG_DEFAULT.theme ?? 'system');
		this.userOverrides = new Set();
		this.persist();
	}
}

export const settingsStore = new SettingsStore();

export const config = () => settingsStore.config;
