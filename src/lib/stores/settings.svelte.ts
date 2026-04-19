import { browser } from '$app/environment';
import {
	CONFIG_LOCALSTORAGE_KEY,
	SETTING_CONFIG_DEFAULT,
	USER_OVERRIDES_LOCALSTORAGE_KEY
} from '$lib/constants';

const THEME_LOCALSTORAGE_KEY = 'theme';
const SYSTEM_MESSAGE_KEY = 'systemMessage';

function parseUserOverrides(rawOverrides: string | null): Set<string> {
	if (!rawOverrides) {
		return new Set();
	}

	try {
		const parsed = JSON.parse(rawOverrides);
		if (!Array.isArray(parsed)) {
			return new Set();
		}

		return new Set(parsed.filter((entry): entry is string => typeof entry === 'string'));
	} catch {
		return new Set();
	}
}

function migrateLegacyConfig(
	config: Record<string, SettingsConfigValue>,
	userOverrides: Set<string>
): boolean {
	if (
		config[SYSTEM_MESSAGE_KEY] === '' &&
		!userOverrides.has(SYSTEM_MESSAGE_KEY) &&
		typeof SETTING_CONFIG_DEFAULT[SYSTEM_MESSAGE_KEY] === 'string'
	) {
		config[SYSTEM_MESSAGE_KEY] = SETTING_CONFIG_DEFAULT[SYSTEM_MESSAGE_KEY];
		return true;
	}

	return false;
}

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

		let nextConfig: SettingsConfigType = { ...SETTING_CONFIG_DEFAULT };
		let didMigrateLegacyConfig = false;

		try {
			const rawConfig = localStorage.getItem(CONFIG_LOCALSTORAGE_KEY);
			const parsedConfig = (rawConfig ? JSON.parse(rawConfig) : {}) as Record<
				string,
				SettingsConfigValue
			>;
			const nextUserOverrides = parseUserOverrides(
				localStorage.getItem(USER_OVERRIDES_LOCALSTORAGE_KEY)
			);

			didMigrateLegacyConfig = migrateLegacyConfig(parsedConfig, nextUserOverrides);
			nextConfig = {
				...SETTING_CONFIG_DEFAULT,
				...parsedConfig
			};
			this.userOverrides = nextUserOverrides;
		} catch {
			this.userOverrides = new Set();
		}

		this.config = nextConfig;
		this.theme = localStorage.getItem(THEME_LOCALSTORAGE_KEY) ?? String(this.config.theme);
		this.isInitialized = true;

		if (didMigrateLegacyConfig) {
			this.persist();
		}
	}

	private persist(): void {
		if (!browser) return;
		localStorage.setItem(CONFIG_LOCALSTORAGE_KEY, JSON.stringify(this.config));
		localStorage.setItem(
			USER_OVERRIDES_LOCALSTORAGE_KEY,
			JSON.stringify(Array.from(this.userOverrides))
		);
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
		this.userOverrides = new Set([...this.userOverrides, 'theme']);
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
