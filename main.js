'use strict';

/*
 * Created with @iobroker/create-adapter v1.21.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

// Load your modules here, e.g.:
const BlinkAPI = require('node-blink-security');

class Blink4home extends utils.Adapter {

	/**
	 * @param {Partial<ioBroker.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			name: 'blink4home',
		});
		this.on('ready', this.onAdapterStart.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		this.on('unload', this.onAdapterStop.bind(this));
		this.timeout = null;
		this.getForeignObject('system.config', (err, obj) => {
			if (obj && obj.native && obj.native.secret) {
				//noinspection JSUnresolvedVariable
				this.config.password = decrypt(obj.native.secret, this.config.password);
			} else {
				//noinspection JSUnresolvedVariable
				this.config.password = decrypt('Zgfr56gFe87jJOM', this.config.password);
			}
			this.log.debug('setup encryption');
		});

		function decrypt(key, value) {
			let result = '';
			for (let i = 0; i < value.length; ++i) {
				result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
			}
			return result;
		}
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onAdapterStart() {
		// Initialize your adapter here

		// this.config: User defined configurations
		this.log.debug('config Username: ' + this.config.username);
		this.log.debug('config Password: ' + (this.config.password ? '*****************' : 'empty!'));
		this.log.debug('config Interval: ' + this.config.pollingInterval);
		this._authtoken = '';

		// inital Blink authentification
		this.blink = new BlinkAPI(this.config.username, this.config.password, "iobroker", {
			"_token" : this.config.token,
			"_region_id" : this.config.regionId,
			"_account_id" : this.config.accountId
		});

		// all states changes inside the adapters namespace are subscribed
		this.pollStatusFromBlinkServers(this, this.config.pollingInterval);
		this.subscribeStates('*');

	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onAdapterStop(callback) {
		try {
			this.timeout && clearTimeout(this.timeout);
			callback();
		} catch (e) {
			callback();
		}
	}

	createStateObjects(summary){
		this.log.debug('start creating blink objects');
		const promises = [];
		Object.entries(summary.network).forEach( (networkAttr) => {
			const key = networkAttr[0];
			const val = networkAttr[1];
			this.log.debug('creating network object '+summary.network.name+'.'+key);
			promises.push(this.setObjectNotExistsAsync(summary.network.name+'.'+key, {
				type: 'state',
				common: {
					name: key,
					type: typeof val,
					role: 'indicator',
					read: true,
					write: false
				},
				native: {
					id: summary.network.name+'.'+key
				}
			}));
		});

		summary.devices.forEach( (device) => {
			this.log.debug('start collecting devices');
			Object.entries(device).forEach( (deviceAttr) => {
				const key = deviceAttr[0];
				const val = deviceAttr[1];
				promises.push(this.setObjectNotExistsAsync(summary.network.name+'.'+device.name+'.'+key, {
					type: 'state',
					common: {
						name: key,
						type: typeof val,
						role: 'indicator',
						read: true,
						write: false
					},
					native: {
						id: summary.network.name+'.'+device.name+'.'+key
					}
				}));
			});
		});
		return promises;
	}

	updateStatesFromSummary(summary){
		Object.entries(summary.network).forEach( (networkAttr) => {
			const key = networkAttr[0];
			const val = networkAttr[1];
			this.setState(summary.network.name+'.'+key, val, true);
		});
		summary.devices.forEach( (device) => {
			Object.entries(device).forEach( (deviceAttr) => {
				const key = deviceAttr[0];
				const val = deviceAttr[1];
				this.setState(summary.network.name+'.'+device.name+'.'+key, val, true);
			});
		});
	}

	pollStatusFromBlinkServers(scope, intsecs){
		scope.log.debug('start polling from server. interval ' + intsecs + ' seconds.');
		scope.blink.setupSystem().then(() => {
			scope.log.debug('connection set up');
			scope.blink.getSummary().then((summary) => {
				scope.log.debug('processing summary');
				const promises = scope.createStateObjects(summary);
				Promise.all(promises).then(() => {
					scope.log.debug('update states from summary');
					scope.updateStatesFromSummary(summary);
					scope.log.debug('updated states, setting timer in '+intsecs+' seconds');
					scope.timeout && clearTimeout(scope.timeout);
					scope.timeout = setTimeout(scope.pollStatusFromBlinkServers, intsecs * 1000, scope, intsecs);
					scope.log.debug('timer set, all is done');
				}).catch((err) => {
					scope.log.error('error: ' + err);
					scope.timeout && clearTimeout(scope.timeout);
					scope.timeout = setTimeout(scope.pollStatusFromBlinkServers, intsecs * 1000, scope, intsecs);
				});
			}, error => {
				scope.log.error(error);
				scope.timeout && clearTimeout(scope.timeout);
				scope.timeout = setTimeout(scope.pollStatusFromBlinkServers, intsecs * 1000, scope, intsecs);
			});
		});
	}

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	onStateChange(id, state) {
		if (state) {
			// The state was changed
			if (state.ack === true){
				return;
			}
			this.log.debug(`state ${id} was changed from outside to: ${state.val}`);
			const idsplit = id.split('.');
			const statename = idsplit[idsplit.length-1];
			if (idsplit.length === 4 && statename === 'armed') {
				const networkname = idsplit[idsplit.length-2];
				let statetext;
				if (state.val === true) {
					statetext = 'armed';
				} else {
					statetext = 'disarmed';
				}

				this.log.info('someone '+statetext+' ('+state.val+') the network '+networkname);
				this.blink.setupSystem(networkname).then(() => {
					this.blink.setArmed(state.val);

				}, error => {
					// @ts-ignore
					this.log.error(error);
				});
			}
			if (idsplit.length === 5 && statename === 'enabled') {
				const cameraname = idsplit[idsplit.length-2];
				let statetext;
				if (state.val === true) {
					statetext = 'setMotionDetection';
				} else {
					statetext = 'setMotionDetection';
				}

				this.log.info('someone '+statetext+' ('+state.val+') for CameraId '+cameraname);
				this.blink.getCameras(cameraname).then(() => {
					this.blink.setMotionDetect(state.val);
				}, error => {
					// @ts-ignore
					this.log.error(error);
				});
			}
		} else {
			// The state was deleted
			this.log.info(`state ${id} deleted`);
		}
	}
}

// @ts-ignore parent is a valid property on module
if (module.parent) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<ioBroker.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new Blink4home(options);
} else {
	// otherwise start the instance directly
	new Blink4home();
}
