import { LitElement, html, css } from 'lit'
import { render } from 'lit/html.js'
import { Epml } from '../../../../epml'
import isElectron from 'is-electron'
import { use, get, translate, translateUnsafeHTML, registerTranslateConfig } from 'lit-translate'

registerTranslateConfig({
	loader: (lang) => fetch(`/language/${lang}.json`).then((res) => res.json())
})

import FileSaver from 'file-saver'
import * as actions from '../../components/qdn-action-types'
import '@material/mwc-button'
import '@material/mwc-icon'
import '@material/mwc-checkbox'
import WebWorker from 'web-worker:./computePowWorkerFile.src.js'
import WebWorkerChat from 'web-worker:./computePowWorker.src.js'
import { publishData } from '../../../utils/publish-image.js'
import { Loader } from '../../../utils/loader.js';
import { QORT_DECIMALS } from '../../../../../crypto/api/constants'
import nacl from '../../../../../crypto/api/deps/nacl-fast.js'
import ed2curve from '../../../../../crypto/api/deps/ed2curve.js'
import { mimeToExtensionMap } from '../../components/qdn-action-constants'
import { base64ToUint8Array, encryptData, fileToBase64, uint8ArrayToBase64 } from '../../components/qdn-action-encryption'

const parentEpml = new Epml({ type: 'WINDOW', source: window.parent })

class WebBrowser extends LitElement {
	static get properties() {
		return {
			selectedAddress: { type: Object },
			url: { type: String },
			name: { type: String },
			service: { type: String },
			identifier: { type: String },
			path: { type: String },
			preview: { type: String },
			displayUrl: { type: String },
			followedNames: { type: Array },
			blockedNames: { type: Array },
			theme: { type: String, reflect: true },
			btcFeePerByte: { type: Number },
			ltcFeePerByte: { type: Number },
			dogeFeePerByte: { type: Number },
			dgbFeePerByte: { type: Number },
			rvnFeePerByte: { type: Number },
			arrrWalletAddress: { type: String },
			theme: { type: String, reflect: true }
		}
	}

	static get observers() {
		return ['_kmxKeyUp(amount)']
	}

	static get styles() {
		return css`
			* {
				--mdc-theme-primary: rgb(3, 169, 244);
				--mdc-theme-secondary: var(--mdc-theme-primary);
				--paper-input-container-focus-color: var(--mdc-theme-primary);
				--mdc-checkbox-unchecked-color: var(--black);
				--mdc-theme-on-surface: var(--black);
				--mdc-checkbox-disabled-color: var(--black);
				--mdc-checkbox-ink-color: var(--black);
			}

			#websitesWrapper paper-button {
				float: right;
			}

			#websitesWrapper .buttons {
				width: auto !important;
			}

			.address-bar {
				position: absolute;
				top: 0;
				left: 0;
				right: 0;
				height: 100px;
				background-color: var(--white);
				height: 36px;
			}

			.address-bar-button mwc-icon {
				width: 20px;
			}

			.iframe-container {
				position: absolute;
				top: 36px;
				left: 0;
				right: 0;
				bottom: 0;
				border-top: 1px solid var(--black);
			}

			.iframe-container iframe {
				display: block;
				width: 100%;
				height: 100%;
				border: none;
				background-color: var(--white);
			}

			input[type='text'] {
				margin: 0;
				padding: 2px 0 0 20px;
				border: 0;
				height: 34px;
				font-size: 16px;
				background-color: var(--white);
			}

			paper-progress {
				--paper-progress-active-color: var(--mdc-theme-primary);
			}

			.float-right {
				float: right;
			}
		`;
	}

	constructor() {
		super();
		this.url = 'about:blank';
		this.myAddress = window.parent.reduxStore.getState().app.selectedAddress;
		this._publicKey = { key: '', hasPubKey: false };
		const urlParams = new URLSearchParams(window.location.search);
		this.name = urlParams.get('name');
		this.service = urlParams.get('service');
		this.identifier =
			urlParams.get('identifier') != null
				? urlParams.get('identifier')
				: null;
		this.path =
			urlParams.get('path') != null
				? (urlParams.get('path').startsWith('/') ? '' : '/') +
				urlParams.get('path')
				: '';
		this.preview = urlParams.get('preview');
		this.followedNames = [];
		this.blockedNames = [];
		this.theme = localStorage.getItem('qortalTheme') ? localStorage.getItem('qortalTheme') : 'light'
		this.loader = new Loader();
		// Build initial display URL
		let displayUrl = 'qortal://' + this.service + '/' + this.name;
		if (
			this.identifier && this.identifier != 'null' &&
			this.identifier != 'default'
		) {
			displayUrl = displayUrl.concat('/' + this.identifier);
		}
		if (this.path != null && this.path != '/')
			displayUrl = displayUrl.concat(this.path);
		this.displayUrl = displayUrl;
		const getFollowedNames = async () => {
			let followedNames = await parentEpml.request('apiCall', {
				url: `/lists/followedNames?apiKey=${this.getApiKey()}`,
			});

			this.followedNames = followedNames;
			setTimeout(
				getFollowedNames,
				this.config.user.nodeSettings.pingInterval
			);
		};

		const getBlockedNames = async () => {
			let blockedNames = await parentEpml.request('apiCall', {
				url: `/lists/blockedNames?apiKey=${this.getApiKey()}`,
			});

			this.blockedNames = blockedNames;
			setTimeout(
				getBlockedNames,
				this.config.user.nodeSettings.pingInterval
			);
		};

		const render = () => {
			const myNode =
				window.parent.reduxStore.getState().app.nodeConfig.knownNodes[
				window.parent.reduxStore.getState().app.nodeConfig.node
				]
			const nodeUrl =
				myNode.protocol + '://' + myNode.domain + ':' + myNode.port

			if (this.preview != null && this.preview.length > 0) {
				// In preview mode we access the preview URL path directly
				this.url = `${nodeUrl}${this.preview}&theme=${this.theme}`
			}
			else {
				// Normal mode

				this.url = `${nodeUrl}/render/${this.service}/${this.name}${this.path != null ? this.path : ''
					}?theme=${this.theme}&identifier=${(this.identifier != null && this.identifier != 'null') ? this.identifier : ''
					}`
			}
		}

		this.selectedAddress = {}
		this.btcFeePerByte = 100
		this.ltcFeePerByte = 30
		this.dogeFeePerByte = 1000
		this.dgbFeePerByte = 10
		this.rvnFeePerByte = 1125
		this.arrrWalletAddress = ''

		let configLoaded = false;

		parentEpml.ready().then(() => {
			parentEpml.subscribe('selected_address', async (selectedAddress) => {
				selectedAddress = JSON.parse(selectedAddress)
				if (!selectedAddress || Object.entries(selectedAddress).length === 0) return

				this.selectedAddress = selectedAddress
				this.btcWallet = window.parent.reduxStore.getState().app.selectedAddress.btcWallet
				this.ltcWallet = window.parent.reduxStore.getState().app.selectedAddress.ltcWallet
				this.dogeWallet = window.parent.reduxStore.getState().app.selectedAddress.dogeWallet
				this.dgbWallet = window.parent.reduxStore.getState().app.selectedAddress.dgbWallet
				this.rvnWallet = window.parent.reduxStore.getState().app.selectedAddress.rvnWallet
				this.arrrWallet = window.parent.reduxStore.getState().app.selectedAddress.arrrWallet
			})
			parentEpml.subscribe('config', (c) => {
				this.config = JSON.parse(c);
				if (!configLoaded) {
					render();
					setTimeout(getFollowedNames, 1);
					setTimeout(getBlockedNames, 1);
					configLoaded = true;
				}
			})
		})
	}

	render() {
		return html`
    			<div id="websitesWrapper" style="width:auto; padding:10px; background: var(--white);">
    				<div class="layout horizontal center">
    					<div class="address-bar">
    						<mwc-button @click=${() => this.goBack()} title="${translate('general.back')}" class="address-bar-button"><mwc-icon>arrow_back_ios</mwc-icon></mwc-button>
    						<mwc-button @click=${() => this.goForward()} title="${translate('browserpage.bchange1')}" class="address-bar-button"><mwc-icon>arrow_forward_ios</mwc-icon></mwc-button>
    						<mwc-button @click=${() => this.refresh()} title="${translate('browserpage.bchange2')}" class="address-bar-button"><mwc-icon>refresh</mwc-icon></mwc-button>
    						<mwc-button @click=${() => this.goBackToList()} title="${translate('browserpage.bchange3')}" class="address-bar-button"><mwc-icon>home</mwc-icon></mwc-button>
    						<input disabled style="width: 550px; color: var(--black);" id="address" type="text" value="${this.displayUrl}"></input>
    						${this.renderFullScreen()}
    						<mwc-button @click=${() => this.delete()} title="${translate('browserpage.bchange4')} ${this.service} ${this.name} ${translate('browserpage.bchange5')}" class="address-bar-button float-right"><mwc-icon>delete</mwc-icon></mwc-button>
    						${this.renderBlockUnblockButton()}
    						${this.renderFollowUnfollowButton()}
    					</div>
    					<div class="iframe-container">
    						<iframe id="browser-iframe" src="${this.url}" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals" allow="fullscreen">
    							<span style="color: var(--black);">${translate('browserpage.bchange6')}</span>
    						</iframe>
    					</div>
    				</div>
    			</div>
		`;
	}

	renderFullScreen() {
		if (window.innerHeight == screen.height) {
			return html`
				<mwc-button
					@click=${() => this.exitFullScreen()}
					title="${translate('browserpage.bchange38')}"
					class="address-bar-button float-right"
				>
					<mwc-icon>fullscreen_exit</mwc-icon>
				</mwc-button>
			`
		} else {
			return html`
				<mwc-button
					@click=${() => this.goFullScreen()}
					title="${translate('browserpage.bchange37')}"
					class="address-bar-button float-right"
				>
					<mwc-icon>fullscreen</mwc-icon>
				</mwc-button>
			`
		}
	}

	goFullScreen() {
		var elem = this.shadowRoot.getElementById('websitesWrapper')

		if (elem.requestFullscreen) {
			elem.requestFullscreen()
		} else if (elem.mozRequestFullScreen) {
			elem.mozRequestFullScreen()
		} else if (elem.webkitRequestFullscreen) {
			elem.webkitRequestFullscreen()
		} else if (elem.msRequestFullscreen) {
			elem.msRequestFullscreen()
		}

		this.renderFullScreen()
	}

	exitFullScreen() {
		if (document.exitFullscreen) {
			document.exitFullscreen()
		} else if (document.mozCancelFullScreen) {
			document.mozCancelFullScreen()
		} else if (document.webkitExitFullscreen) {
			document.webkitExitFullscreen()
		} else if (document.msExitFullscreen) {
			document.msExitFullscreen()
		}

		this.renderFullScreen()
	}

	async unitJoinFee() {
		const myNode = window.parent.reduxStore.getState().app.nodeConfig.knownNodes[window.parent.reduxStore.getState().app.nodeConfig.node]
		const nodeUrl = myNode.protocol + '://' + myNode.domain + ':' + myNode.port
		const url = `${nodeUrl}/transactions/unitfee?txType=JOIN_GROUP`
		const response = await fetch(url)
		if (!response.ok) {
			throw new Error('Error when fetching join fee');
		}

		const data = await response.json()
		const joinFee = (Number(data) / 1e8).toFixed(8)
		return joinFee
	}

	async deployAtFee() {
		const myNode = window.parent.reduxStore.getState().app.nodeConfig.knownNodes[window.parent.reduxStore.getState().app.nodeConfig.node]
		const nodeUrl = myNode.protocol + '://' + myNode.domain + ':' + myNode.port
		const url = `${nodeUrl}/transactions/unitfee?txType=DEPLOY_AT`
		const response = await fetch(url)
		if (!response.ok) {
			throw new Error('Error when fetching join fee');
		}

		const data = await response.json()
		const joinFee = (Number(data) / 1e8).toFixed(8)
		return joinFee
	}
	async sendQortFee() {
		const myNode = window.parent.reduxStore.getState().app.nodeConfig.knownNodes[window.parent.reduxStore.getState().app.nodeConfig.node]
		const nodeUrl = myNode.protocol + '://' + myNode.domain + ':' + myNode.port
		const url = `${nodeUrl}/transactions/unitfee?txType=PAYMENT`
		const response = await fetch(url)
		if (!response.ok) {
			throw new Error('Error when fetching join fee');
		}

		const data = await response.json()
		const qortFee = (Number(data) / 1e8).toFixed(8)
		return qortFee
	}

	async _joinGroup(groupId, groupName) {
		const joinFeeInput = await this.unitJoinFee()
		const getLastRef = async () => {
			let myRef = await parentEpml.request('apiCall', {
				type: 'api',
				url: `/addresses/lastreference/${this.selectedAddress.address}`
			})
			return myRef
		};

		const validateReceiver = async () => {
			let lastRef = await getLastRef();
			let myTransaction = await makeTransactionRequest(lastRef)
			const res = getTxnRequestResponse(myTransaction)
			return res
		}

		const makeTransactionRequest = async (lastRef) => {
			let groupdialog1 = get("transactions.groupdialog1")
			let groupdialog2 = get("transactions.groupdialog2")
			let myTxnrequest = await parentEpml.request('transaction', {
				type: 31,
				nonce: this.selectedAddress.nonce,
				params: {
					fee: joinFeeInput,
					registrantAddress: this.selectedAddress.address,
					rGroupName: groupName,
					rGroupId: groupId,
					lastReference: lastRef,
					groupdialog1: groupdialog1,
					groupdialog2: groupdialog2
				},
				apiVersion: 2
			})
			return myTxnrequest
		}

		const getTxnRequestResponse = (txnResponse) => {
			if (txnResponse.success === false && txnResponse.message) {
				throw new Error(txnResponse.message)
			} else if (txnResponse.success === true && !txnResponse.data.error) {
				return txnResponse.data
			} else if (txnResponse.data && txnResponse.data.message) {
				throw new Error(txnResponse.data.message)
			} else {
				throw new Error('Server error. Could not perform action.')
			}
		}
		const groupRes = await validateReceiver()
		return groupRes

	}

	async _deployAt(name, description, tags, creationBytes, amount, assetId, fee, atType) {
		const deployAtFee = await this.deployAtFee()
		const getLastRef = async () => {
			let myRef = await parentEpml.request('apiCall', {
				type: 'api',
				url: `/addresses/lastreference/${this.selectedAddress.address}`
			})
			return myRef
		};

		const validateReceiver = async () => {
			let lastRef = await getLastRef();
			let myTransaction = await makeTransactionRequest(lastRef)
			const res = getTxnRequestResponse(myTransaction)
			return res
		}

		const makeTransactionRequest = async (lastRef) => {
			let groupdialog1 = get("transactions.groupdialog1")
			let groupdialog2 = get("transactions.groupdialog2")
			let myTxnrequest = await parentEpml.request('transaction', {
				type: 16,
				nonce: this.selectedAddress.nonce,
				params: {
					fee: fee || deployAtFee,
					rName: name,
					rDescription: description,
					rTags: tags,
					rAmount: amount,
					rAssetId: assetId,
					rCreationBytes: creationBytes,
					atType: atType,
					lastReference: lastRef,
					atDeployDialog1: groupdialog1,
					atDeployDialog2: groupdialog2
				},
				apiVersion: 2
			})
			return myTxnrequest
		}

		const getTxnRequestResponse = (txnResponse) => {
			if (txnResponse.success === false && txnResponse.message) {
				throw new Error(txnResponse.message)
			} else if (txnResponse.success === true && !txnResponse.data.error) {
				return txnResponse.data
			} else if (txnResponse.data && txnResponse.data.message) {
				throw new Error(txnResponse.data.message)
			} else {
				throw new Error('Server error. Could not perform action.')
			}
		}
		const groupRes = await validateReceiver()
		return groupRes

	}

	firstUpdated() {
		this.changeTheme();
		this.changeLanguage();

		this.btcWallet = window.parent.reduxStore.getState().app.selectedAddress.btcWallet
		this.ltcWallet = window.parent.reduxStore.getState().app.selectedAddress.ltcWallet
		this.dogeWallet = window.parent.reduxStore.getState().app.selectedAddress.dogeWallet
		this.dgbWallet = window.parent.reduxStore.getState().app.selectedAddress.dgbWallet
		this.rvnWallet = window.parent.reduxStore.getState().app.selectedAddress.rvnWallet
		this.arrrWallet = window.parent.reduxStore.getState().app.selectedAddress.arrrWallet

		window.addEventListener('storage', () => {
			const checkLanguage = localStorage.getItem('qortalLanguage');
			const checkTheme = localStorage.getItem('qortalTheme');

			use(checkLanguage);

			if (checkTheme === 'dark') {
				this.theme = 'dark';
			} else {
				this.theme = 'light';
			}
			document.querySelector('html').setAttribute('theme', this.theme);
		});

		if (!isElectron()) {
		} else {
			window.addEventListener('contextmenu', (event) => {
				event.preventDefault()
				window.parent.electronAPI.showMyMenu()
			})
		}

		window.addEventListener('message', async (event) => {
			if (
				event == null ||
				event.data == null ||
				event.data.length == 0 ||
				event.data.action == null
			) {
				return;
			}

			let response = '{"error": "Request could not be fulfilled"}';
			let data = event.data;

			switch (data.action) {
				case actions.GET_USER_ACCOUNT: {

					let skip = false;
					if (window.parent.reduxStore.getState().app.qAPPAutoAuth) {
						skip = true;
					}
					let res1;
					if (!skip) {
						res1 = await showModalAndWait(
							actions.GET_USER_ACCOUNT,
							{
								service: this.service,
								name: this.name
							}
						);
					};
					if ((res1 && res1.action === 'accept') || skip) {
						let account = {};
						account['address'] = this.selectedAddress.address;
						account['publicKey'] =
							this.selectedAddress.base58PublicKey;
						response = JSON.stringify(account);
						break;
					} else {
						const data = {};
						const errorMsg = "User declined to share account details"
						data['error'] = errorMsg;
						response = JSON.stringify(data);
						break;
					}
				}

				case actions.DECRYPT_DATA: {
					const requiredFields = ['encryptedData', 'publicKey'];
					const missingFields = [];

					requiredFields.forEach((field) => {
						if (!data[field]) {
							missingFields.push(field);
						}
					});

					if (missingFields.length > 0) {
						const missingFieldsString = missingFields.join(', ');
						const errorMsg = `Missing fields: ${missingFieldsString}`
						let data = {};
						data['error'] = errorMsg;
						response = JSON.stringify(data);
						break
					}
					const { encryptedData, publicKey } = data


					try {
						const uint8Array = base64ToUint8Array(encryptedData)
						const combinedData = uint8Array
						const str = "qortalEncryptedData";
						const strEncoder = new TextEncoder();
						const strUint8Array = strEncoder.encode(str);

						const strData = combinedData.slice(0, strUint8Array.length);
						const nonce = combinedData.slice(strUint8Array.length, strUint8Array.length + 24);
						const _encryptedData = combinedData.slice(strUint8Array.length + 24);

						const privateKey = window.parent.reduxStore.getState().app.selectedAddress.keyPair.privateKey
						const _publicKey = window.parent.Base58.decode(publicKey)

						if (!privateKey || !_publicKey) {
							data['error'] = "Unable to retrieve keys"
							response = JSON.stringify(data);
							break
						}

						const convertedPrivateKey = ed2curve.convertSecretKey(privateKey)
						const convertedPublicKey = ed2curve.convertPublicKey(_publicKey)
						const sharedSecret = new Uint8Array(32);
						nacl.lowlevel.crypto_scalarmult(sharedSecret, convertedPrivateKey, convertedPublicKey)

						const _chatEncryptionSeed = new window.parent.Sha256().process(sharedSecret).finish().result
						const _decryptedData = nacl.secretbox.open(_encryptedData, nonce, _chatEncryptionSeed)
						const decryptedDataToBase64 = uint8ArrayToBase64(_decryptedData)
						response = JSON.stringify(decryptedDataToBase64);

						break;
					} catch (error) {
						console.log({ error })
						const data = {};
						const errorMsg = error.message || "Error in decrypting data"
						data['error'] = errorMsg;
						response = JSON.stringify(data);
						break
					}
				}
				case actions.GET_LIST_ITEMS: {
					const requiredFields = ['list_name'];
					const missingFields = [];

					requiredFields.forEach((field) => {
						if (!data[field]) {
							missingFields.push(field);
						}
					});

					if (missingFields.length > 0) {
						const missingFieldsString = missingFields.join(', ');
						const errorMsg = `Missing fields: ${missingFieldsString}`
						let data = {};
						data['error'] = errorMsg;
						response = JSON.stringify(data);
						break
					}
					let skip = false;
					if (window.parent.reduxStore.getState().app.qAPPAutoLists) {
						skip = true;
					}
					let res1;
					if (!skip) {
						res1 = await showModalAndWait(
							actions.GET_LIST_ITEMS,
							{
								list_name: data.list_name
							}
						);
					};


					if (res1 && res1.action === 'accept' || skip) {

						try {
							const list = await parentEpml.request('apiCall', {
								type: 'api',
								url: `/lists/${data.list_name}?apiKey=${this.getApiKey()}`,
							});
							response = JSON.stringify(list);

						} catch (error) {
							const data = {};
							const errorMsg = "Error in retrieving list"
							data['error'] = errorMsg;
							response = JSON.stringify(data);
						} finally {
							break;
						}

					} else {
						const data = {};
						const errorMsg = "User declined to share list"
						data['error'] = errorMsg;
						response = JSON.stringify(data);
						break;
					}
				};
				case actions.ADD_LIST_ITEMS: {
					const requiredFields = ['list_name', 'items'];
					const missingFields = [];

					requiredFields.forEach((field) => {
						if (!data[field]) {
							missingFields.push(field);
						}
					});

					if (missingFields.length > 0) {
						const missingFieldsString = missingFields.join(', ');
						const errorMsg = `Missing fields: ${missingFieldsString}`
						let data = {};
						data['error'] = errorMsg;
						response = JSON.stringify(data);
						break
					}
					const items = data.items
					const list_name = data.list_name
					const res = await showModalAndWait(
						actions.ADD_LIST_ITEMS,
						{
							list_name: list_name,
							items: items
						}
					);

					if (res && res.action === 'accept') {

						try {
							const body = {
								items: items,
							};

							const bodyToString = JSON.stringify(body);
							const data = await parentEpml.request('apiCall', {
								type: 'api',
								method: 'POST',
								url: `/lists/${list_name}?apiKey=${this.getApiKey()}`,
								body: bodyToString,
								headers: {
									'Content-Type': 'application/json',
								},
							});
							response = data
						} catch (error) {
							const data = {};
							const errorMsg = "Error in adding to list"
							data['error'] = errorMsg;
							response = JSON.stringify(data);
						} finally {
							break;
						}

					} else {
						const data = {};
						const errorMsg = "User declined add to list"
						data['error'] = errorMsg;
						response = JSON.stringify(data);
						break;
					}
				};
				case actions.DELETE_LIST_ITEM: {
					const requiredFields = ['list_name', 'item'];
					const missingFields = [];

					requiredFields.forEach((field) => {
						if (!data[field]) {
							missingFields.push(field);
						}
					});

					if (missingFields.length > 0) {
						const missingFieldsString = missingFields.join(', ');
						const errorMsg = `Missing fields: ${missingFieldsString}`
						let data = {};
						data['error'] = errorMsg;
						response = JSON.stringify(data);
						break
					}
					const item = data.item
					const list_name = data.list_name
					const res = await showModalAndWait(
						actions.DELETE_LIST_ITEM,
						{
							list_name: list_name,
							item: item
						}
					);

					if (res && res.action === 'accept') {

						try {
							const body = {
								items: [item],
							};

							const bodyToString = JSON.stringify(body);

							const data = await parentEpml.request('apiCall', {
								type: 'api',
								method: 'DELETE',
								url: `/lists/${list_name}?apiKey=${this.getApiKey()}`,
								body: bodyToString,
								headers: {
									'Content-Type': 'application/json',
								},
							});
							response = data
						} catch (error) {
							const data = {};
							const errorMsg = "Error in adding to list"
							data['error'] = errorMsg;
							response = JSON.stringify(data);
						} finally {
							break;
						}

					} else {
						const data = {};
						const errorMsg = "User declined add to list"
						data['error'] = errorMsg;
						response = JSON.stringify(data);
						break;
					}
				};


				case actions.LINK_TO_QDN_RESOURCE:
				case actions.QDN_RESOURCE_DISPLAYED:
					// Links are handled by the core, but the UI also listens for these actions in order to update the address bar.
					// Note: don't update this.url here, as we don't want to force reload the iframe each time.
					if (this.preview != null && this.preview.length > 0) {
						this.displayUrl = translate("appspage.schange40");
						return;
					}

					let url = 'qortal://' + data.service + '/' + data.name;
					this.path =
						data.path != null
							? (data.path.startsWith('/') ? '' : '/') + data.path
							: null;
					if (
						data.identifier != null &&
						data.identifier != '' &&
						data.identifier != 'default'
					)
						url = url.concat('/' + data.identifier);
					if (this.path != null && this.path != '/')
						url = url.concat(this.path);
					this.name = data.name;
					this.service = data.service;
					this.identifier = data.identifier;
					this.displayUrl = url;
					return;

				case actions.PUBLISH_QDN_RESOURCE: {
					// optional fields: encrypt:boolean recipientPublicKey:string
					const requiredFields = ['service', 'name'];
					const missingFields = [];

					requiredFields.forEach((field) => {
						if (!data[field]) {
							missingFields.push(field);
						}
					});

					if (missingFields.length > 0) {
						const missingFieldsString = missingFields.join(', ');
						const errorMsg = `Missing fields: ${missingFieldsString}`
						let data = {};
						data['error'] = errorMsg;
						response = JSON.stringify(data);
						break
					}
					if (!data.file && !data.data64) {
						let data = {};
						data['error'] = "No data or file was submitted";
						response = JSON.stringify(data);
						break
					}
					// Use "default" if user hasn't specified an identifer
					const service = data.service;
					const name = data.name;
					let identifier = data.identifier;
					let data64 = data.data64;
					const filename = data.filename;
					const title = data.title;
					const description = data.description;
					const category = data.category;
					const tag1 = data.tag1;
					const tag2 = data.tag2;
					const tag3 = data.tag3;
					const tag4 = data.tag4;
					const tag5 = data.tag5;
					if (data.identifier == null) {
						identifier = 'default';
					}

					if (data.encrypt && !data.recipientPublicKey) {
						let data = {};
						data['error'] = "Encrypting data requires the recipient's public key";
						response = JSON.stringify(data);
						break
					}
					if (!data.encrypt && data.service.endsWith("_PRIVATE")) {
						let data = {};
						data['error'] = "Only encrypted data can go into private services";
						response = JSON.stringify(data);
						break
					}

					if (data.encrypt) {
						try {
							const encryptDataResponse = encryptData({
								data64, recipientPublicKey: data.recipientPublicKey
							})
							if (encryptDataResponse.encryptedData) {
								data64 = encryptDataResponse.encryptedData
							}

						} catch (error) {
							const obj = {};
							const errorMsg = error.message || 'Upload failed due to failed encryption';
							obj['error'] = errorMsg;
							response = JSON.stringify(obj);
							break
						}

					}


					const res2 = await showModalAndWait(
						actions.PUBLISH_QDN_RESOURCE,
						{
							name,
							identifier,
							service,
							encrypt: data.encrypt
						}
					);
					if (res2.action === 'accept') {
						if (data.file && !data.encrypt) {
							data64 = await fileToBase64(data.file)
						}
						const worker = new WebWorker();
						try {
							this.loader.show();
							const resPublish = await publishData({
								registeredName: encodeURIComponent(name),
								file: data64,
								service: service,
								identifier: encodeURIComponent(identifier),
								parentEpml,
								uploadType: 'file',
								selectedAddress: this.selectedAddress,
								worker: worker,
								isBase64: true,
								filename: filename,
								title,
								description,
								category,
								tag1,
								tag2,
								tag3,
								tag4,
								tag5,
								apiVersion: 2,
								withFee: res2.userData.isWithFee === true ? true : false
							});

							response = JSON.stringify(resPublish);
							worker.terminate();
						} catch (error) {
							worker.terminate();
							const obj = {};
							const errorMsg = error.message || 'Upload failed';
							obj['error'] = errorMsg;
							response = JSON.stringify(obj);
							console.error(error);
							break;
						} finally {
							this.loader.hide();
						}
					} else if (res2.action === 'reject') {
						response = '{"error": "User declined request"}';
					}
					// Params: data.service, data.name, data.identifier, data.data64,
					// TODO: prompt user for publish. If they confirm, call `POST /arbitrary/{service}/{name}/{identifier}/base64` and sign+process transaction
					// then set the response string from the core to the `response` variable (defined above)
					// If they decline, send back JSON that includes an `error` key, such as `{"error": "User declined request"}`
					break;
				}
				case actions.PUBLISH_MULTIPLE_QDN_RESOURCES: {
					const requiredFields = ['resources'];
					const missingFields = [];

					requiredFields.forEach((field) => {
						if (!data[field]) {
							missingFields.push(field);
						}
					});

					if (missingFields.length > 0) {
						const missingFieldsString = missingFields.join(', ');
						const errorMsg = `Missing fields: ${missingFieldsString}`
						let data = {};
						data['error'] = errorMsg;
						response = JSON.stringify(data);
						break
					}
					const resources = data.resources
					if (!Array.isArray(resources)) {
						let data = {};
						data['error'] = "Invalid data"
						response = JSON.stringify(data);
						break
					}
					if (resources.length === 0) {
						let data = {};
						data['error'] = "No resources to publish"
						response = JSON.stringify(data);
						break
					}
					if (data.encrypt && !data.recipientPublicKey) {
						let data = {};
						data['error'] = "Encrypting data requires the recipient's public key";
						response = JSON.stringify(data);
						break
					}
					const res2 = await showModalAndWait(
						actions.PUBLISH_MULTIPLE_QDN_RESOURCES,
						{
							resources,
							encrypt: data.encrypt
						}
					);

					if (res2.action === 'reject') {
						response = '{"error": "User declined request"}';
						break

					}
					const resourcesMap = resources.map(async (resource) => {
						const requiredFields = ['service', 'name'];
						const missingFields = [];

						requiredFields.forEach((field) => {
							if (!resource[field]) {
								missingFields.push(field);
							}
						});

						if (missingFields.length > 0) {
							const missingFieldsString = missingFields.join(', ');
							const errorMsg = `Missing fields: ${missingFieldsString}`
							throw new Error(errorMsg)
						}

						if (!resource.file && !resource.data64) {

							throw new Error('No data or file was submitted')
						}

						const service = resource.service;
						const name = resource.name;
						let identifier = resource.identifier;
						let data64 = resource.data64;
						const filename = resource.filename;
						const title = resource.title;
						const description = resource.description;
						const category = resource.category;
						const tag1 = resource.tag1;
						const tag2 = resource.tag2;
						const tag3 = resource.tag3;
						const tag4 = resource.tag4;
						const tag5 = resource.tag5;
						if (resource.identifier == null) {
							identifier = 'default';
						}

						if (!data.encrypt && service.endsWith("_PRIVATE")) {
							throw new Error("Only encrypted data can go into private services")
						}

						if (data.encrypt) {
							try {
								const encryptDataResponse = encryptData({
									data64, recipientPublicKey: data.recipientPublicKey
								})
								if (encryptDataResponse.encryptedData) {
									data64 = encryptDataResponse.encryptedData
								}

							} catch (error) {
								const errorMsg = error.message || 'Upload failed due to failed encryption'
								throw new Error(errorMsg)
							}

						}
						if (resource.file && !data.encrypt) {
							data64 = await fileToBase64(resource.file)
						}


						const worker = new WebWorker();
						try {

							const resPublish = await publishData({
								registeredName: encodeURIComponent(name),
								file: data64,
								service: service,
								identifier: encodeURIComponent(identifier),
								parentEpml,
								uploadType: 'file',
								selectedAddress: this.selectedAddress,
								worker: worker,
								isBase64: true,
								filename: filename,
								title,
								description,
								category,
								tag1,
								tag2,
								tag3,
								tag4,
								tag5,
								apiVersion: 2,
								withFee: res2.userData.isWithFee === true ? true : false
							});

							worker.terminate();
							return resPublish
						} catch (error) {
							worker.terminate();
							const errorMsg = error.message || 'Upload failed';
							throw new Error(errorMsg)
						}


					})

					try {
						this.loader.show();
						const results = await Promise.all(resourcesMap);
						response = JSON.stringify(results);
						this.loader.hide();
						break
						// handle successful results
					} catch (error) {
						const obj = {};
						const errorMsg = error.message || 'Upload failed';
						obj['error'] = errorMsg;
						response = JSON.stringify(obj);
						this.loader.hide();
						break;
					}

					// Params: data.service, data.name, data.identifier, data.data64,
					// TODO: prompt user for publish. If they confirm, call `POST /arbitrary/{service}/{name}/{identifier}/base64` and sign+process transaction
					// then set the response string from the core to the `response` variable (defined above)
					// If they decline, send back JSON that includes an `error` key, such as `{"error": "User declined request"}`
					break;
				}


				case actions.SEND_CHAT_MESSAGE: {
					const message = data.message;
					const recipient = data.destinationAddress;
					const groupId = data.groupId;
					const isRecipient = groupId ? false : true
					const sendMessage = async (messageText, chatReference) => {

						let _reference = new Uint8Array(64);
						window.crypto.getRandomValues(_reference);
						let reference = window.parent.Base58.encode(_reference);
						const sendMessageRequest = async () => {
							let chatResponse

							if (isRecipient) {
								chatResponse = await parentEpml.request('chat', {
									type: 18,
									nonce: this.selectedAddress.nonce,
									params: {
										timestamp: Date.now(),
										recipient: recipient,
										recipientPublicKey: this._publicKey.key,
										hasChatReference: 0,
										chatReference: chatReference,
										message: messageText,
										lastReference: reference,
										proofOfWorkNonce: 0,
										isEncrypted: 1,
										isText: 1
									}
								});


							}

							if (!isRecipient) {
								chatResponse = await parentEpml.request('chat', {
									type: 181,
									nonce: this.selectedAddress.nonce,
									params: {
										timestamp: Date.now(),
										groupID: Number(groupId),
										hasReceipient: 0,
										hasChatReference: 0,
										chatReference: chatReference,
										message: messageText,
										lastReference: reference,
										proofOfWorkNonce: 0,
										isEncrypted: 0,
										isText: 1
									}
								});


							}

							const msgResponse = await _computePow(chatResponse)
							return msgResponse;
						};

						const _computePow = async (chatBytes) => {
							const difficulty = 8;
							const path = window.parent.location.origin + '/memory-pow/memory-pow.wasm.full'
							const worker = new WebWorkerChat();
							let nonce = null;
							let chatBytesArray = null;

							await new Promise((res) => {
								worker.postMessage({ chatBytes, path, difficulty });
								worker.onmessage = e => {
									chatBytesArray = e.data.chatBytesArray;
									nonce = e.data.nonce;
									res();
								}
							});

							let _response = await parentEpml.request('sign_chat', {
								nonce: this.selectedAddress.nonce,
								chatBytesArray: chatBytesArray,
								chatNonce: nonce,
								apiVersion: 2
							});

							const chatResponse = getSendChatResponse(_response);
							return chatResponse;
						};

						const getSendChatResponse = (res) => {
							if (res.signature) {
								return res
							} else if (res.error) {
								throw new Error(res.message);
							} else {
								throw new Error('ERROR: Could not send message');
							}
						};

						const chatResponse = await sendMessageRequest();
						return chatResponse;
					}

					const result = await showModalAndWait(
						actions.SEND_CHAT_MESSAGE
					);
					if (result.action === "accept") {
						let hasPublicKey = true;

						if (isRecipient) {
							const res = await parentEpml.request('apiCall', {
								type: 'api',
								url: `/addresses/publickey/${recipient}`
							});

							if (res.error === 102) {
								this._publicKey.key = ''
								this._publicKey.hasPubKey = false
								hasPublicKey = false;
							} else if (res !== false) {
								this._publicKey.key = res
								this._publicKey.hasPubKey = true
							} else {
								this._publicKey.key = ''
								this._publicKey.hasPubKey = false
								hasPublicKey = false;
							}
						}


						if (!hasPublicKey && isRecipient) {
							response = '{"error": "Cannot send an encrypted message to this user since they do not have their publickey on chain."}';
							break
						}



						const tiptapJson = {
							type: 'doc',
							content: [
								{
									type: 'paragraph',
									content: [
										{
											type: 'text',
											text: message,
										},

									],
								},
							],
						}

						const messageObject = {
							messageText: tiptapJson,
							images: [''],
							repliedTo: '',
							version: 3
						};

						const stringifyMessageObject = JSON.stringify(messageObject);
						// if (this.balance < 4) {
						// 		this.myTrimmedMeassage = ''
						// 		this.myTrimmedMeassage = stringifyMessageObject
						// 		this.shadowRoot.getElementById('confirmDialog').open()
						// } else {
						// this.sendMessage(stringifyMessageObject, typeMessage);
						// }
						try {
							this.loader.show();
							const msgResponse = await sendMessage(stringifyMessageObject);
							response = msgResponse;
						} catch (error) {
							console.error(error);
							if (error.message) {
								let data = {};
								data['error'] = error.message;
								response = JSON.stringify(data);
								break
							}
							response = '{"error": "Request could not be fulfilled"}';
						} finally {
							this.loader.hide();

						}

					} else {
						response = '{"error": "User declined request"}';
					}
					// this.loader.show();
					// Params: data.groupId, data.destinationAddress, data.message
					// TODO: prompt user to send chat message. If they confirm, sign+process a CHAT transaction
					// then set the response string from the core to the `response` variable (defined above)
					// If they decline, send back JSON that includes an `error` key, such as `{"error": "User declined request"}`
					break;
				}

				case actions.JOIN_GROUP: {
					const requiredFields = ['groupId'];
					const missingFields = [];

					requiredFields.forEach((field) => {
						if (!data[field]) {
							missingFields.push(field);
						}
					});

					if (missingFields.length > 0) {
						const missingFieldsString = missingFields.join(', ');
						const errorMsg = `Missing fields: ${missingFieldsString}`
						let data = {};
						data['error'] = errorMsg;
						response = JSON.stringify(data);
						break
					}
					const groupId = data.groupId;


					let groupInfo = null
					try {
						groupInfo = await parentEpml.request("apiCall", {
							type: "api",
							url: `/groups/${groupId}`,
						});
					} catch (error) {
						const errorMsg = (error && error.message) || 'Group not found';
						let obj = {};
						obj['error'] = errorMsg;
						response = JSON.stringify(obj);
						break
					}

					if (!groupInfo || groupInfo.error) {
						const errorMsg = (groupInfo && groupInfo.message) || 'Group not found';
						let obj = {};
						obj['error'] = errorMsg;
						response = JSON.stringify(obj);
						break
					}

					try {
						this.loader.show();
						const resJoinGroup = await this._joinGroup(groupId, groupInfo.groupName)
						response = JSON.stringify(resJoinGroup);
					} catch (error) {
						const obj = {};
						const errorMsg = error.message || 'Failed to join the group.';
						obj['error'] = errorMsg;
						response = JSON.stringify(obj);
					} finally {
						this.loader.hide();
					}

					// Params: data.groupId
					// TODO: prompt user to join group. If they confirm, sign+process a JOIN_GROUP transaction
					// then set the response string from the core to the `response` variable (defined above)
					// If they decline, send back JSON that includes an `error` key, such as `{"error": "User declined request"}`
					break;
				}
				case actions.SAVE_FILE: {
					try {

						const requiredFields = ['filename', 'blob'];
						const missingFields = [];

						requiredFields.forEach((field) => {
							if (!data[field]) {
								missingFields.push(field);
							}
						});

						if (missingFields.length > 0) {
							const missingFieldsString = missingFields.join(', ');
							const errorMsg = `Missing fields: ${missingFieldsString}`
							let data = {};
							data['error'] = errorMsg;
							response = JSON.stringify(data);
							break
						}



						const filename = data.filename
						const blob = data.blob

						const res = await showModalAndWait(
							actions.SAVE_FILE,
							{
								filename
							}
						);

						if (res.action === 'reject') {
							response = '{"error": "User declined request"}';
							break

						}

						const mimeType = blob.type || data.mimeType
						let backupExention = filename.split('.').pop()
						if (backupExention) {
							backupExention = '.' + backupExention
						}
						const fileExtension = mimeToExtensionMap[mimeType] || backupExention
						let fileHandleOptions = {}
						if (!mimeType) {
							const obj = {};
							const errorMsg = 'A mimeType could not be derived';
							obj['error'] = errorMsg;
							response = JSON.stringify(obj);
							break
						}
						if (!fileExtension) {
							const obj = {};
							const errorMsg = 'A file extension could not be derived';
							obj['error'] = errorMsg;
							response = JSON.stringify(obj);
							break
						}
						if (fileExtension && mimeType) {
							fileHandleOptions = {
								accept: {
									[mimeType]: [fileExtension]
								}
							}
						}

						try {
							const fileHandle = await self.showSaveFilePicker({
								suggestedName: filename,
								types: [
									{
										description: mimeType,
										...fileHandleOptions
									},
								]


							})
							const writeFile = async (fileHandle, contents) => {
								const writable = await fileHandle.createWritable()
								await writable.write(contents)
								await writable.close()
							}
							writeFile(fileHandle, blob).then(() => console.log("FILE SAVED"))
						} catch (error) {
							if (error.name === 'AbortError') {
								const obj = {};
								const errorMsg = 'User declined the download';
								obj['error'] = errorMsg;
								response = JSON.stringify(obj);
								break
							}
							FileSaver.saveAs(blob, filename)
						}

						response = JSON.stringify(true);
					} catch (error) {
						const obj = {};
						const errorMsg = error.message || 'Failed to initiate download';
						obj['error'] = errorMsg;
						response = JSON.stringify(obj);
					}
					break;
				}

				// case 'DEPLOY_AT': {
				// 	const requiredFields = ['name', 'description', 'tags', 'creationBytes', 'amount', 'assetId', 'type'];
				// 	const missingFields = [];

				// 	requiredFields.forEach((field) => {
				// 		if (!data[field]) {
				// 			missingFields.push(field);
				// 		}
				// 	});

				// 	if (missingFields.length > 0) {
				// 		const missingFieldsString = missingFields.join(', ');
				// 		const errorMsg = `Missing fields: ${missingFieldsString}`
				// 		let data = {};
				// 		data['error'] = errorMsg;
				// 		response = JSON.stringify(data);
				// 		break
				// 	}


				// 	try {
				// 		this.loader.show();
				// 		const fee = data.fee || undefined
				// 		const resJoinGroup = await this._deployAt(data.name, data.description, data.tags, data.creationBytes, data.amount, data.assetId, fee, data.type)
				// 		response = JSON.stringify(resJoinGroup);
				// 	} catch (error) {
				// 		const obj = {};
				// 		const errorMsg = error.message || 'Failed to join the group.';
				// 		obj['error'] = errorMsg;
				// 		response = JSON.stringify(obj);
				// 	} finally {
				// 		this.loader.hide();
				// 	}
				// 	break;
				// }


				case actions.GET_WALLET_BALANCE: {
					const requiredFields = ['coin'];
					const missingFields = [];

					requiredFields.forEach((field) => {
						if (!data[field]) {
							missingFields.push(field);
						}
					});

					if (missingFields.length > 0) {
						const missingFieldsString = missingFields.join(', ');
						const errorMsg = `Missing fields: ${missingFieldsString}`
						let data = {};
						data['error'] = errorMsg;
						response = JSON.stringify(data);
						break
					}
					// Params: data.coin (QORT / BTC / LTC / DOGE / DGB / RVN / ARRR)
					// TODO: prompt user to share wallet balance. If they confirm, call `GET /crosschain/:coin/walletbalance`, or for QORT, call `GET /addresses/balance/:address`
					// then set the response string from the core to the `response` variable (defined above)
					// If they decline, send back JSON that includes an `error` key, such as `{"error": "User declined request"}`
					const res3 = await showModalAndWait(
						actions.GET_WALLET_BALANCE
					);

					if (res3.action === 'accept') {
						let coin = data.coin;
						if (coin === "QORT") {
							let qortAddress = window.parent.reduxStore.getState().app.selectedAddress.address
							try {
								this.loader.show();
								const QORTBalance = await parentEpml.request('apiCall', {
									url: `/addresses/balance/${qortAddress}?apiKey=${this.getApiKey()}`,
								})
								response = QORTBalance


							} catch (error) {
								console.error(error);
								const data = {};
								const errorMsg = error.message || get("browserpage.bchange21");
								data['error'] = errorMsg;
								response = JSON.stringify(data);

							} finally {
								this.loader.hide();
							}
						}
						// else {
						// 	let _url = ``
						// 	let _body = null

						// 	switch (coin) {
						// 		case 'LTC':
						// 			_url = `/crosschain/ltc/walletbalance?apiKey=${this.getApiKey()}`
						// 			_body = window.parent.reduxStore.getState().app.selectedAddress.ltcWallet.derivedMasterPublicKey
						// 			break
						// 		case 'DOGE':
						// 			_url = `/crosschain/doge/walletbalance?apiKey=${this.getApiKey()}`
						// 			_body = window.parent.reduxStore.getState().app.selectedAddress.dogeWallet.derivedMasterPublicKey
						// 			break
						// 		case 'DGB':
						// 			_url = `/crosschain/dgb/walletbalance?apiKey=${this.getApiKey()}`
						// 			_body = window.parent.reduxStore.getState().app.selectedAddress.dgbWallet.derivedMasterPublicKey
						// 			break
						// 		case 'RVN':
						// 			_url = `/crosschain/rvn/walletbalance?apiKey=${this.getApiKey()}`
						// 			_body = window.parent.reduxStore.getState().app.selectedAddress.rvnWallet.derivedMasterPublicKey
						// 			break
						// 		case 'ARRR':
						// 			_url = `/crosschain/arrr/walletbalance?apiKey=${this.getApiKey()}`
						// 			_body = window.parent.reduxStore.getState().app.selectedAddress.arrrWallet.seed58
						// 			break
						// 		default:
						// 			break
						// 	}
						// 	try {
						// 		this.loader.show();
						// 		const res = await parentEpml.request('apiCall', {
						// 			url: _url,
						// 			method: 'POST',
						// 			body: _body,
						// 		})
						// 		if (isNaN(Number(res))) {
						// 			const data = {};
						// 			const errorMsg = error.message || get("browserpage.bchange21");
						// 			data['error'] = errorMsg;
						// 			response = JSON.stringify(data);
						// 			return;
						// 		} else {
						// 			response = (Number(res) / 1e8).toFixed(8);
						// 		}
						// 	} catch (error) {
						// 		console.error(error);
						// 		const data = {};
						// 		const errorMsg = error.message || get("browserpage.bchange21");
						// 		data['error'] = errorMsg;
						// 		response = JSON.stringify(data);
						// 		return;
						// 	} finally {
						// 		this.loader.hide()
						// 	}
						// }
					} else if (res3.action === 'reject') {
						response = '{"error": "User declined request"}';
					}

					break;
				}


				case actions.SEND_COIN: {
					const requiredFields = ['coin', 'destinationAddress', 'amount']
					const missingFields = []

					requiredFields.forEach((field) => {
						if (!data[field]) {
							missingFields.push(field)
						}
					})

					if (missingFields.length > 0) {
						const missingFieldsString = missingFields.join(', ')
						const errorMsg = `Missing fields: ${missingFieldsString}`
						showErrorAndWait("MISSING_FIELDS", errorMsg)
						let data = {}
						data['error'] = errorMsg
						response = JSON.stringify(data)
						break
					}

					let checkCoin = data.coin

					if (checkCoin === "QORT") {
						// Params: data.coin, data.destinationAddress, data.amount, data.fee
						// TODO: prompt user to send. If they confirm, call `POST /crosschain/:coin/send`, or for QORT, broadcast a PAYMENT transaction
						// then set the response string from the core to the `response` variable (defined above)
						// If they decline, send back JSON that includes an `error` key, such as `{"error": "User declined request"}`
						const amount = Number(data.amount)
						const recipient = data.destinationAddress
						const coin = data.coin

						const walletBalance = await parentEpml.request('apiCall', {
							url: `/addresses/balance/${this.myAddress.address}`,
						})

						if (isNaN(Number(walletBalance))) {
							let errorMsg = "Failed to Fetch QORT Balance. Try again!"
							let failedMsg = get("walletpage.wchange33") + " QORT " + get("general.balance")
							let pleaseMsg = get("walletpage.wchange44")
							showErrorAndWait("FAILED_FETCH", failedMsg, pleaseMsg)
							let obj = {}
							obj['error'] = errorMsg
							response = JSON.stringify(obj)
							break
						}

						const myRef = await parentEpml.request("apiCall", {
							type: "api",
							url: `/addresses/lastreference/${this.myAddress.address}`,
						})

						const transformDecimals = (Number(walletBalance) * QORT_DECIMALS).toFixed(0)
						const walletBalanceDecimals = Number(transformDecimals)
						const amountDecimals = Number(amount) * QORT_DECIMALS
						const balance = (Number(transformDecimals) / 1e8).toFixed(8)
						const fee = await this.sendQortFee()

						if (amountDecimals + (fee * QORT_DECIMALS) > walletBalanceDecimals) {
							let errorMsg = "Insufficient Funds!"
							let failedMsg = get("walletpage.wchange26")
							let pleaseMsg = get("walletpage.wchange44")
							showErrorAndWait("INSSUFFICIENT_FUNDS", failedMsg, pleaseMsg)
							let obj = {}
							obj['error'] = errorMsg
							response = JSON.stringify(obj)
							break
						}

						if (amount <= 0) {
							let errorMsg = "Invalid Amount!"
							showErrorAndWait("INVALID_AMOUNT", errorMsg)
							let obj = {}
							obj['error'] = errorMsg
							response = JSON.stringify(obj)
							break
						}

						if (recipient.length === 0) {
							let errorMsg = "Receiver cannot be empty!"
							showErrorAndWait("NO_RECEIVER", errorMsg)
							let obj = {}
							obj['error'] = errorMsg
							response = JSON.stringify(obj)
							break
						}

						const processPayment = await showModalAndWait(
							actions.SEND_COIN,
							{
								amount,
								recipient,
								coin,
								balance
							}
						)

						if (processPayment.action === 'reject') {
							let errorMsg = "User declined request"
							let myMsg1 = get("transactions.declined")
							let myMsg2 = get("walletpage.wchange44")
							showErrorAndWait("DECLINED_REQUEST", myMsg1, myMsg2)
							response = '{"error": "User declined request"}'
							break
						}

						const validateName = async (receiverName) => {
							let myRes
							let myNameRes = await parentEpml.request('apiCall', {
								type: 'api',
								url: `/names/${receiverName}`,
							})

							if (myNameRes.error === 401) {
								myRes = false
							} else {
								myRes = myNameRes
							}
							return myRes
						}

						const validateAddress = async (receiverAddress) => {
							let myAddress = await window.parent.validateAddress(receiverAddress)
							return myAddress
						}

						const validateReceiver = async (recipient) => {
							let lastRef = myRef
							let isAddress

							try {
								isAddress = await validateAddress(recipient)
							} catch (err) {
								isAddress = false
							}

							if (isAddress) {
								let myTransaction = await makeTransactionRequest(recipient, lastRef)
								const res = getTxnRequestResponse(myTransaction)
								return res
							} else {
								let myNameRes = await validateName(recipient)
								if (myNameRes !== false) {
									let myNameAddress = myNameRes.owner
									let myTransaction = await makeTransactionRequest(myNameAddress, lastRef)
									const res = getTxnRequestResponse(myTransaction)
									return res
								} else {
									let errorMsg = get("walletpage.wchange29")
									let pleaseMsg = get("walletpage.wchange44")
									showErrorAndWait("INVALID_RECEIVER", errorMsg, pleaseMsg)
									throw new Error(errorMsg)
								}
							}
						}

						const getName = async (recipient) => {
							try {
								const getNames = await parentEpml.request("apiCall", {
									type: "api",
									url: `/names/address/${recipient}`
								})

								if (getNames.length > 0) {
									return getNames[0].name
								} else {
									return ''
								}
							} catch (error) {
								return ""
							}
						}

						this.loader.show()

						const makeTransactionRequest = async (receiver, lastRef) => {
							let myReceiver = receiver
							let mylastRef = lastRef
							let dialogamount = get("transactions.amount")
							let dialogAddress = get("login.address")
							let dialogName = get("login.name")
							let dialogto = get("transactions.to")
							let recipientName = await getName(myReceiver)
							let myTxnrequest = await parentEpml.request('transaction', {
								type: 2,
								nonce: this.myAddress.nonce,
								params: {
									recipient: myReceiver,
									recipientName: recipientName,
									amount: amount,
									lastReference: mylastRef,
									fee: fee,
									dialogamount: dialogamount,
									dialogto: dialogto,
									dialogAddress,
									dialogName
								},
								apiVersion: 2
							})
							return myTxnrequest
						}

						const getTxnRequestResponse = (txnResponse) => {
							if (txnResponse.success === false && txnResponse.message) {
								this.loader.hide()
								throw new Error(txnResponse.message)
							} else if (txnResponse.success === true && !txnResponse.data.error) {
								this.loader.hide()
								return txnResponse.data
							} else {
								this.loader.hide()
								throw new Error('Error: could not send coin')
							}

						}

						try {
							const result = await validateReceiver(recipient)
							response = result
						} catch (error) {
							console.error(error)
							response = '{"error": "Request could not be fulfilled"}'
						} finally {
							this.loader.hide()
						}
						break
					} else if (checkCoin === "BTC") {
						this.loader.show()
						const amount = Number(data.amount)
						const recipient = data.destinationAddress
						const coin = data.coin
						const xprv58 = this.btcWallet.derivedMasterPrivateKey

						const btcWalletBalance = await parentEpml.request('apiCall', {
							url: `/crosschain/btc/walletbalance?apiKey=${this.getApiKey()}`,
							method: 'POST',
							body: `${this.btcWallet.derivedMasterPublicKey}`
						})

						if (isNaN(Number(btcWalletBalance))) {
							this.loader.hide()
							let errorMsg = "Failed to Fetch BTC Balance. Try again!"
							let failedMsg = get("walletpage.wchange33") + " BTC " + get("general.balance")
							let pleaseMsg = get("walletpage.wchange44")
							showErrorAndWait("FAILED_FETCH", failedMsg, pleaseMsg)
							let obj = {}
							obj['error'] = errorMsg
							response = JSON.stringify(obj)
							break
						}

						const btcWalletBalanceDecimals = Number(btcWalletBalance)
						const btcAmountDecimals = Number(amount) * QORT_DECIMALS
						const balance = (Number(btcWalletBalance) / 1e8).toFixed(8)
						const fee = 50000

						if (btcAmountDecimals + fee > btcWalletBalanceDecimals) {
							this.loader.hide()
							let errorMsg = "Insufficient Funds!"
							let failedMsg = get("walletpage.wchange26")
							let pleaseMsg = get("walletpage.wchange44")
							showErrorAndWait("INSSUFFICIENT_FUNDS", failedMsg, pleaseMsg)
							let obj = {}
							obj['error'] = errorMsg
							response = JSON.stringify(obj)
							break
						}

						this.loader.hide()

						const processPayment = await showModalAndWait(
							actions.SEND_COIN,
							{
								amount,
								recipient,
								coin,
								balance
							}
						)

						if (processPayment.action === 'reject') {
							let errorMsg = "User declined request"
							let myMsg1 = get("transactions.declined")
							let myMsg2 = get("walletpage.wchange44")
							showErrorAndWait("DECLINED_REQUEST", myMsg1, myMsg2)
							response = '{"error": "User declined request"}'
							break
						}

						this.loader.show()

						const makeRequest = async () => {
							const opts = {
								xprv58: xprv58,
								receivingAddress: recipient,
								bitcoinAmount: amount,
								feePerByte: (this.btcFeePerByte / 1e8).toFixed(8)
							}
							const response = await parentEpml.request('sendBtc', opts)
							return response
						}

						const manageResponse = (response) => {
							if (response.length === 64) {
								this.loader.hide()
								let successMsg = get("walletpage.wchange30")
								let patientMsg = get("walletpage.wchange43")
								showErrorAndWait("TRANSACTION_SUCCESS", successMsg, patientMsg)
							} else if (response === false) {
								this.loader.hide()
								let errorMsg = get("walletpage.wchange31")
								let pleaseMsg = get("walletpage.wchange44")
								showErrorAndWait("TRANSACTION_FAILED", errorMsg, pleaseMsg)
							} else {
								this.loader.hide()
								let errorMsg = response.message
								let pleaseMsg = get("walletpage.wchange44")
								showErrorAndWait("TRANSACTION_FAILED", errorMsg, pleaseMsg)
								throw new Error(response)
							}
						}

						try {
							const res = await makeRequest()
							manageResponse(res)
						} catch (error) {
							console.error(error)
							response = '{"error": "Request could not be fulfilled"}'
						} finally {
							this.loader.hide()
						}
						break
					} else if (checkCoin === "LTC") {
						this.loader.show()
						const amount = Number(data.amount)
						const recipient = data.destinationAddress
						const coin = data.coin
						const xprv58 = this.ltcWallet.derivedMasterPrivateKey

						const ltcWalletBalance = await parentEpml.request('apiCall', {
							url: `/crosschain/ltc/walletbalance?apiKey=${this.getApiKey()}`,
							method: 'POST',
							body: `${this.ltcWallet.derivedMasterPublicKey}`
						})

						if (isNaN(Number(ltcWalletBalance))) {
							this.loader.hide()
							let errorMsg = "Failed to Fetch LTC Balance. Try again!"
							let failedMsg = get("walletpage.wchange33") + " LTC " + get("general.balance")
							let pleaseMsg = get("walletpage.wchange44")
							showErrorAndWait("FAILED_FETCH", failedMsg, pleaseMsg)
							let obj = {}
							obj['error'] = errorMsg
							response = JSON.stringify(obj)
							break
						}

						const ltcWalletBalanceDecimals = Number(ltcWalletBalance)
						const ltcAmountDecimals = Number(amount) * QORT_DECIMALS
						const balance = (Number(ltcWalletBalance) / 1e8).toFixed(8)
						const fee = 30000

						if (ltcAmountDecimals + fee > ltcWalletBalanceDecimals) {
							this.loader.hide()
							let errorMsg = "Insufficient Funds!"
							let failedMsg = get("walletpage.wchange26")
							let pleaseMsg = get("walletpage.wchange44")
							showErrorAndWait("INSSUFFICIENT_FUNDS", failedMsg, pleaseMsg)
							let obj = {}
							obj['error'] = errorMsg
							response = JSON.stringify(obj)
							break
						}

						this.loader.hide()

						const processPayment = await showModalAndWait(
							actions.SEND_COIN,
							{
								amount,
								recipient,
								coin,
								balance
							}
						)

						if (processPayment.action === 'reject') {
							let errorMsg = "User declined request"
							let myMsg1 = get("transactions.declined")
							let myMsg2 = get("walletpage.wchange44")
							showErrorAndWait("DECLINED_REQUEST", myMsg1, myMsg2)
							response = '{"error": "User declined request"}'
							break
						}

						this.loader.show()

						const makeRequest = async () => {
							const opts = {
								xprv58: xprv58,
								receivingAddress: recipient,
								litecoinAmount: amount,
								feePerByte: (this.ltcFeePerByte / 1e8).toFixed(8)
							}
							const response = await parentEpml.request('sendLtc', opts)
							return response
						}

						const manageResponse = (response) => {
							if (response.length === 64) {
								this.loader.hide()
								let successMsg = get("walletpage.wchange30")
								let patientMsg = get("walletpage.wchange43")
								showErrorAndWait("TRANSACTION_SUCCESS", successMsg, patientMsg)
							} else if (response === false) {
								this.loader.hide()
								let errorMsg = get("walletpage.wchange31")
								let pleaseMsg = get("walletpage.wchange44")
								showErrorAndWait("TRANSACTION_FAILED", errorMsg, pleaseMsg)
							} else {
								this.loader.hide()
								let errorMsg = response.message
								let pleaseMsg = get("walletpage.wchange44")
								showErrorAndWait("TRANSACTION_FAILED", errorMsg, pleaseMsg)
								throw new Error(response)
							}
						}

						try {
							const res = await makeRequest()
							manageResponse(res)
						} catch (error) {
							console.error(error)
							response = '{"error": "Request could not be fulfilled"}'
						} finally {
							this.loader.hide()
						}
						break
					} else if (checkCoin === "DOGE") {
						this.loader.show()
						const amount = Number(data.amount)
						const recipient = data.destinationAddress
						const coin = data.coin
						const xprv58 = this.dogeWallet.derivedMasterPrivateKey

						const dogeWalletBalance = await parentEpml.request('apiCall', {
							url: `/crosschain/doge/walletbalance?apiKey=${this.getApiKey()}`,
							method: 'POST',
							body: `${this.dogeWallet.derivedMasterPublicKey}`
						})

						if (isNaN(Number(dogeWalletBalance))) {
							this.loader.hide()
							let errorMsg = "Failed to Fetch DOGE Balance. Try again!"
							let failedMsg = get("walletpage.wchange33") + " DOGE " + get("general.balance")
							let pleaseMsg = get("walletpage.wchange44")
							showErrorAndWait("FAILED_FETCH", failedMsg, pleaseMsg)
							let obj = {}
							obj['error'] = errorMsg
							response = JSON.stringify(obj)
							break
						}

						const dogeWalletBalanceDecimals = Number(dogeWalletBalance)
						const dogeAmountDecimals = Number(amount) * QORT_DECIMALS
						const balance = (Number(dogeWalletBalance) / 1e8).toFixed(8)
						const fee = 5000000

						if (dogeAmountDecimals + fee > dogeWalletBalanceDecimals) {
							this.loader.hide()
							let errorMsg = "Insufficient Funds!"
							let failedMsg = get("walletpage.wchange26")
							let pleaseMsg = get("walletpage.wchange44")
							showErrorAndWait("INSSUFFICIENT_FUNDS", failedMsg, pleaseMsg)
							let obj = {}
							obj['error'] = errorMsg
							response = JSON.stringify(obj)
							break
						}

						this.loader.hide()

						const processPayment = await showModalAndWait(
							actions.SEND_COIN,
							{
								amount,
								recipient,
								coin,
								balance
							}
						)

						if (processPayment.action === 'reject') {
							let errorMsg = "User declined request"
							let myMsg1 = get("transactions.declined")
							let myMsg2 = get("walletpage.wchange44")
							showErrorAndWait("DECLINED_REQUEST", myMsg1, myMsg2)
							response = '{"error": "User declined request"}'
							break
						}

						this.loader.show()

						const makeRequest = async () => {
							const opts = {
								xprv58: xprv58,
								receivingAddress: recipient,
								dogecoinAmount: amount,
								feePerByte: (this.dogeFeePerByte / 1e8).toFixed(8)
							}
							const response = await parentEpml.request('sendDoge', opts)
							return response
						}

						const manageResponse = (response) => {
							if (response.length === 64) {
								this.loader.hide()
								let successMsg = get("walletpage.wchange30")
								let patientMsg = get("walletpage.wchange43")
								showErrorAndWait("TRANSACTION_SUCCESS", successMsg, patientMsg)
							} else if (response === false) {
								this.loader.hide()
								let errorMsg = get("walletpage.wchange31")
								let pleaseMsg = get("walletpage.wchange44")
								showErrorAndWait("TRANSACTION_FAILED", errorMsg, pleaseMsg)
							} else {
								this.loader.hide()
								let errorMsg = response.message
								let pleaseMsg = get("walletpage.wchange44")
								showErrorAndWait("TRANSACTION_FAILED", errorMsg, pleaseMsg)
								throw new Error(response)
							}
						}

						try {
							const res = await makeRequest()
							manageResponse(res)
						} catch (error) {
							console.error(error)
							response = '{"error": "Request could not be fulfilled"}'
						} finally {
							this.loader.hide()
						}
						break
					} else if (checkCoin === "DGB") {
						this.loader.show()
						const amount = Number(data.amount)
						const recipient = data.destinationAddress
						const coin = data.coin
						const xprv58 = this.dgbWallet.derivedMasterPrivateKey

						const dgbWalletBalance = await parentEpml.request('apiCall', {
							url: `/crosschain/dgb/walletbalance?apiKey=${this.getApiKey()}`,
							method: 'POST',
							body: `${this.dgbWallet.derivedMasterPublicKey}`
						})

						if (isNaN(Number(dgbWalletBalance))) {
							this.loader.hide()
							let errorMsg = "Failed to Fetch DGB Balance. Try again!"
							let failedMsg = get("walletpage.wchange33") + " DGB " + get("general.balance")
							let pleaseMsg = get("walletpage.wchange44")
							showErrorAndWait("FAILED_FETCH", failedMsg, pleaseMsg)
							let obj = {}
							obj['error'] = errorMsg
							response = JSON.stringify(obj)
							break
						}

						const dgbWalletBalanceDecimals = Number(dgbWalletBalance)
						const dgbAmountDecimals = Number(amount) * QORT_DECIMALS
						const balance = (Number(dgbWalletBalance) / 1e8).toFixed(8)
						const fee = 5000

						if (dgbAmountDecimals + fee > dgbWalletBalanceDecimals) {
							this.loader.hide()
							let errorMsg = "Insufficient Funds!"
							let failedMsg = get("walletpage.wchange26")
							let pleaseMsg = get("walletpage.wchange44")
							showErrorAndWait("INSSUFFICIENT_FUNDS", failedMsg, pleaseMsg)
							let obj = {}
							obj['error'] = errorMsg
							response = JSON.stringify(obj)
							break
						}

						this.loader.hide()

						const processPayment = await showModalAndWait(
							actions.SEND_COIN,
							{
								amount,
								recipient,
								coin,
								balance
							}
						)

						if (processPayment.action === 'reject') {
							let errorMsg = "User declined request"
							let myMsg1 = get("transactions.declined")
							let myMsg2 = get("walletpage.wchange44")
							showErrorAndWait("DECLINED_REQUEST", myMsg1, myMsg2)
							response = '{"error": "User declined request"}'
							break
						}

						this.loader.show()

						const makeRequest = async () => {
							const opts = {
								xprv58: xprv58,
								receivingAddress: recipient,
								digibyteAmount: amount,
								feePerByte: (this.dgbFeePerByte / 1e8).toFixed(8)
							}
							const response = await parentEpml.request('sendDgb', opts)
							return response
						}

						const manageResponse = (response) => {
							if (response.length === 64) {
								this.loader.hide()
								let successMsg = get("walletpage.wchange30")
								let patientMsg = get("walletpage.wchange43")
								showErrorAndWait("TRANSACTION_SUCCESS", successMsg, patientMsg)
							} else if (response === false) {
								this.loader.hide()
								let errorMsg = get("walletpage.wchange31")
								let pleaseMsg = get("walletpage.wchange44")
								showErrorAndWait("TRANSACTION_FAILED", errorMsg, pleaseMsg)
							} else {
								this.loader.hide()
								let errorMsg = response.message
								let pleaseMsg = get("walletpage.wchange44")
								showErrorAndWait("TRANSACTION_FAILED", errorMsg, pleaseMsg)
								throw new Error(response)
							}
						}

						try {
							const res = await makeRequest()
							manageResponse(res)
						} catch (error) {
							console.error(error)
							response = '{"error": "Request could not be fulfilled"}'
						} finally {
							this.loader.hide()
						}
						break
					} else if (checkCoin === "RVN") {
						this.loader.show()
						const amount = Number(data.amount)
						const recipient = data.destinationAddress
						const coin = data.coin
						const xprv58 = this.rvnWallet.derivedMasterPrivateKey

						const rvnWalletBalance = await parentEpml.request('apiCall', {
							url: `/crosschain/rvn/walletbalance?apiKey=${this.getApiKey()}`,
							method: 'POST',
							body: `${this.rvnWallet.derivedMasterPublicKey}`
						})

						if (isNaN(Number(rvnWalletBalance))) {
							this.loader.hide()
							let errorMsg = "Failed to Fetch RVN Balance. Try again!"
							let failedMsg = get("walletpage.wchange33") + " RVN " + get("general.balance")
							let pleaseMsg = get("walletpage.wchange44")
							showErrorAndWait("FAILED_FETCH", failedMsg, pleaseMsg)
							let obj = {}
							obj['error'] = errorMsg
							response = JSON.stringify(obj)
							break
						}

						const rvnWalletBalanceDecimals = Number(rvnWalletBalance)
						const rvnAmountDecimals = Number(amount) * QORT_DECIMALS
						const balance = (Number(rvnWalletBalance) / 1e8).toFixed(8)
						const fee = 562500

						if (rvnAmountDecimals + fee > rvnWalletBalanceDecimals) {
							this.loader.hide()
							let errorMsg = "Insufficient Funds!"
							let failedMsg = get("walletpage.wchange26")
							let pleaseMsg = get("walletpage.wchange44")
							showErrorAndWait("INSSUFFICIENT_FUNDS", failedMsg, pleaseMsg)
							let obj = {}
							obj['error'] = errorMsg
							response = JSON.stringify(obj)
							break
						}

						this.loader.hide()

						const processPayment = await showModalAndWait(
							actions.SEND_COIN,
							{
								amount,
								recipient,
								coin,
								balance
							}
						)

						if (processPayment.action === 'reject') {
							let errorMsg = "User declined request"
							let myMsg1 = get("transactions.declined")
							let myMsg2 = get("walletpage.wchange44")
							showErrorAndWait("DECLINED_REQUEST", myMsg1, myMsg2)
							response = '{"error": "User declined request"}'
							break
						}

						this.loader.show()

						const makeRequest = async () => {
							const opts = {
								xprv58: xprv58,
								receivingAddress: recipient,
								ravencoinAmount: amount,
								feePerByte: (this.rvnFeePerByte / 1e8).toFixed(8)
							}
							const response = await parentEpml.request('sendRvn', opts)
							return response
						}

						const manageResponse = (response) => {
							if (response.length === 64) {
								this.loader.hide()
								let successMsg = get("walletpage.wchange30")
								let patientMsg = get("walletpage.wchange43")
								showErrorAndWait("TRANSACTION_SUCCESS", successMsg, patientMsg)
							} else if (response === false) {
								this.loader.hide()
								let errorMsg = get("walletpage.wchange31")
								let pleaseMsg = get("walletpage.wchange44")
								showErrorAndWait("TRANSACTION_FAILED", errorMsg, pleaseMsg)
							} else {
								this.loader.hide()
								let errorMsg = response.message
								let pleaseMsg = get("walletpage.wchange44")
								showErrorAndWait("TRANSACTION_FAILED", errorMsg, pleaseMsg)
								throw new Error(response)
							}
						}

						try {
							const res = await makeRequest()
							manageResponse(res)
						} catch (error) {
							console.error(error)
							response = '{"error": "Request could not be fulfilled"}'
						} finally {
							this.loader.hide()
						}
						break
					} else if (checkCoin === "ARRR") {
						this.loader.show()
						const amount = Number(data.amount)
						const recipient = data.destinationAddress
						const coin = data.coin
						const memo = data.memo
						const seed58 = this.arrrWallet.seed58

						const arrrWalletBalance = await parentEpml.request('apiCall', {
							url: `/crosschain/arrr/walletbalance?apiKey=${this.getApiKey()}`,
							method: 'POST',
							body: `${this.arrrWallet.seed58}`
						})

						if (isNaN(Number(arrrWalletBalance))) {
							this.loader.hide()
							let errorMsg = "Failed to Fetch ARRR Balance. Try again!"
							let failedMsg = get("walletpage.wchange33") + " ARRR " + get("general.balance")
							let pleaseMsg = get("walletpage.wchange44")
							showErrorAndWait("FAILED_FETCH", failedMsg, pleaseMsg)
							let obj = {}
							obj['error'] = errorMsg
							response = JSON.stringify(obj)
							break
						}

						const arrrWalletBalanceDecimals = Number(arrrWalletBalance)
						const arrrAmountDecimals = Number(amount) * QORT_DECIMALS
						const balance = (Number(arrrWalletBalance) / 1e8).toFixed(8)
						const fee = 10000

						if (arrrAmountDecimals + fee > arrrWalletBalanceDecimals) {
							this.loader.hide()
							let errorMsg = "Insufficient Funds!"
							let failedMsg = get("walletpage.wchange26")
							let pleaseMsg = get("walletpage.wchange44")
							showErrorAndWait("INSSUFFICIENT_FUNDS", failedMsg, pleaseMsg)
							let obj = {}
							obj['error'] = errorMsg
							response = JSON.stringify(obj)
							break
						}

						this.loader.hide()

						const processPayment = await showModalAndWait(
							actions.SEND_COIN,
							{
								amount,
								recipient,
								coin,
								balance
							}
						)

						if (processPayment.action === 'reject') {
							let errorMsg = "User declined request"
							let myMsg1 = get("transactions.declined")
							let myMsg2 = get("walletpage.wchange44")
							showErrorAndWait("DECLINED_REQUEST", myMsg1, myMsg2)
							response = '{"error": "User declined request"}'
							break
						}

						this.loader.show()

						const makeRequest = async () => {
							const opts = {
								entropy58: seed58,
								receivingAddress: recipient,
								arrrAmount: amount,
								memo: memo
							}
							const response = await parentEpml.request('sendArrr', opts)
							return response
						}

						const manageResponse = (response) => {
							if (response.length === 64) {
								this.loader.hide()
								let successMsg = get("walletpage.wchange30")
								let patientMsg = get("walletpage.wchange43")
								showErrorAndWait("TRANSACTION_SUCCESS", successMsg, patientMsg)
							} else if (response === false) {
								this.loader.hide()
								let errorMsg = get("walletpage.wchange31")
								let pleaseMsg = get("walletpage.wchange44")
								showErrorAndWait("TRANSACTION_FAILED", errorMsg, pleaseMsg)
							} else {
								this.loader.hide()
								let errorMsg = response.message
								let pleaseMsg = get("walletpage.wchange44")
								showErrorAndWait("TRANSACTION_FAILED", errorMsg, pleaseMsg)
								throw new Error(response)
							}
						}

						try {
							const res = await makeRequest()
							manageResponse(res)
						} catch (error) {
							console.error(error)
							response = '{"error": "Request could not be fulfilled"}'
						} finally {
							this.loader.hide()
						}
						break
					}
				}

				default:
					console.log('Unhandled message: ' + JSON.stringify(data))
					return
			}

			// Parse response
			let responseObj;
			try {
				responseObj = JSON.parse(response);
			} catch (e) {
				// Not all responses will be JSON
				responseObj = response;
			}
			// Respond to app
			if (responseObj.error != null) {
				event.ports[0].postMessage({
					result: null,
					error: responseObj,
				});
			} else {
				event.ports[0].postMessage({
					result: responseObj,
					error: null,
				});
			}
		});
	}

	changeTheme() {
		const checkTheme = localStorage.getItem('qortalTheme');
		if (checkTheme === 'dark') {
			this.theme = 'dark';
		} else {
			this.theme = 'light';
		}
		document.querySelector('html').setAttribute('theme', this.theme);
	}

	changeLanguage() {
		const checkLanguage = localStorage.getItem('qortalLanguage');

		if (checkLanguage === null || checkLanguage.length === 0) {
			localStorage.setItem('qortalLanguage', 'us');
			use('us');
		} else {
			use(checkLanguage);
		}
	}

	renderFollowUnfollowButton() {
		// Only show the follow/unfollow button if we have permission to modify the list on this node
		if (this.followedNames == null || !Array.isArray(this.followedNames)) {
			return html``;
		}

		if (this.followedNames.indexOf(this.name) === -1) {
			// render follow button
			return html`<mwc-button
				@click=${() => this.follow()}
				title="${translate('browserpage.bchange7')} ${this.name}"
				class="address-bar-button float-right"
				><mwc-icon>add_to_queue</mwc-icon></mwc-button
			>`;
		} else {
			// render unfollow button
			return html`<mwc-button
				@click=${() => this.unfollow()}
				title="${translate('browserpage.bchange8')} ${this.name}"
				class="address-bar-button float-right"
				><mwc-icon>remove_from_queue</mwc-icon></mwc-button
			>`;
		}
	}

	renderBlockUnblockButton() {
		// Only show the block/unblock button if we have permission to modify the list on this node
		if (this.blockedNames == null || !Array.isArray(this.blockedNames)) {
			return html``;
		}

		if (this.blockedNames.indexOf(this.name) === -1) {
			// render block button
			return html`<mwc-button
				@click=${() => this.block()}
				title="${translate('browserpage.bchange9')} ${this.name}"
				class="address-bar-button float-right"
				><mwc-icon>block</mwc-icon></mwc-button
			>`;
		} else {
			// render unblock button
			return html`<mwc-button
				@click=${() => this.unblock()}
				title="${translate('browserpage.bchange10')} ${this.name}"
				class="address-bar-button float-right"
				><mwc-icon>radio_button_unchecked</mwc-icon></mwc-button
			>`;
		}
	}

	// Navigation

	goBack() {
		window.history.back();
	}

	goForward() {
		window.history.forward();
	}

	refresh() {
		const myNode =
			window.parent.reduxStore.getState().app.nodeConfig.knownNodes[
			window.parent.reduxStore.getState().app.nodeConfig.node
			];
		const nodeUrl =
			myNode.protocol + '://' + myNode.domain + ':' + myNode.port;
		this.url = `${nodeUrl}/render/${this.service}/${this.name}${this.path != null ? this.path : ''
			}?theme=${this.theme}&identifier=${this.identifier != null ? this.identifier : ''
			}&time=${new Date().getMilliseconds()}`;
	}

	goBackToList() {
		if (this.service == "APP") {
			this.exitFullScreen()
			window.location = '../../q-app/index.html';
		}
		else { // Default to websites list
			this.exitFullScreen()
			window.location = '../index.html';
		}
	}

	follow() {
		this.followName(this.name);
	}

	unfollow() {
		this.unfollowName(this.name);
	}

	block() {
		this.blockName(this.name);
	}

	unblock() {
		this.unblockName(this.name);
	}

	delete() {
		this.deleteCurrentResource();
	}

	async followName(name) {
		let items = [name];
		let namesJsonString = JSON.stringify({ items: items });

		let ret = await parentEpml.request('apiCall', {
			url: `/lists/followedNames?apiKey=${this.getApiKey()}`,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: `${namesJsonString}`,
		});

		if (ret === true) {
			// Successfully followed - add to local list
			// Remove it first by filtering the list - doing it this way ensures the UI updates
			// immediately, as apposed to only adding if it doesn't already exist
			this.followedNames = this.followedNames.filter(
				(item) => item != name
			);
			this.followedNames.push(name);
		} else {
			let err1string = get('browserpage.bchange11');
			parentEpml.request('showSnackBar', `${err1string}`);
		}

		return ret;
	}

	async unfollowName(name) {
		let items = [name];
		let namesJsonString = JSON.stringify({ items: items });

		let ret = await parentEpml.request('apiCall', {
			url: `/lists/followedNames?apiKey=${this.getApiKey()}`,
			method: 'DELETE',
			headers: {
				'Content-Type': 'application/json',
			},
			body: `${namesJsonString}`,
		});

		if (ret === true) {
			// Successfully unfollowed - remove from local list
			this.followedNames = this.followedNames.filter(
				(item) => item != name
			);
		} else {
			let err2string = get('browserpage.bchange12');
			parentEpml.request('showSnackBar', `${err2string}`);
		}

		return ret;
	}

	async blockName(name) {
		let items = [name];
		let namesJsonString = JSON.stringify({ items: items });

		let ret = await parentEpml.request('apiCall', {
			url: `/lists/blockedNames?apiKey=${this.getApiKey()}`,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: `${namesJsonString}`,
		});

		if (ret === true) {
			// Successfully blocked - add to local list
			// Remove it first by filtering the list - doing it this way ensures the UI updates
			// immediately, as apposed to only adding if it doesn't already exist
			this.blockedNames = this.blockedNames.filter(
				(item) => item != name
			);
			this.blockedNames.push(name);
		} else {
			let err3string = get('browserpage.bchange13');
			parentEpml.request('showSnackBar', `${err3string}`);
		}

		return ret;
	}

	async unblockName(name) {
		let items = [name];
		let namesJsonString = JSON.stringify({ items: items });

		let ret = await parentEpml.request('apiCall', {
			url: `/lists/blockedNames?apiKey=${this.getApiKey()}`,
			method: 'DELETE',
			headers: {
				'Content-Type': 'application/json',
			},
			body: `${namesJsonString}`,
		});

		if (ret === true) {
			// Successfully unblocked - remove from local list
			this.blockedNames = this.blockedNames.filter(
				(item) => item != name
			);
		} else {
			let err4string = get('browserpage.bchange14');
			parentEpml.request('showSnackBar', `${err4string}`);
		}

		return ret;
	}

	async deleteCurrentResource() {
		if (this.followedNames.indexOf(this.name) != -1) {
			// Following name - so deleting won't work
			let err5string = get('browserpage.bchange15');
			parentEpml.request('showSnackBar', `${err5string}`);
			return;
		}

		let identifier = (this.identifier == null || this.identifier.length == 0) ? 'default' : this.identifier;

		let ret = await parentEpml.request('apiCall', {
			url: `/arbitrary/resource/${this.service}/${this.name
				}/${identifier}?apiKey=${this.getApiKey()}`,
			method: 'DELETE',
		});

		if (ret === true) {
			this.goBackToList();
		} else {
			let err6string = get('browserpage.bchange16');
			parentEpml.request('showSnackBar', `${err6string}`);
		}

		return ret;
	}

	getApiKey() {
		const myNode =
			window.parent.reduxStore.getState().app.nodeConfig.knownNodes[
			window.parent.reduxStore.getState().app.nodeConfig.node
			];
		let apiKey = myNode.apiKey;
		return apiKey;
	}
}

window.customElements.define('web-browser', WebBrowser);

async function showModalAndWait(type, data) {
	// Create a new Promise that resolves with user data and an action when the user clicks a button
	return new Promise((resolve) => {
		// Create the modal and add it to the DOM
		const modal = document.createElement('div');
		modal.id = "backdrop"
		modal.classList.add("backdrop");
		modal.innerHTML = `
			<div class="modal my-modal-class">
				<div class="modal-content">
					<div class="modal-body">

						${type === actions.GET_USER_ACCOUNT ? `
							<div class="modal-subcontainer">
								<p class="modal-paragraph">${`<span class="capitalize-first">${data.service.toLowerCase()}</span> ${get("browserpage.bchange18")}`}</p>
								<p class="modal-paragraph">${get("browserpage.bchange24")} ${data.service.toLowerCase()}.</p>
								<p class="modal-paragraph">${get("browserpage.bchange25")}</p>
								<div class="checkbox-row">
									<label for="authButton" id="authButtonLabel" style="color: var(--black);">
										${get('browserpage.bchange26')}
									</label>
									<mwc-checkbox style="margin-right: -15px;" id="authButton" ?checked=${window.parent.reduxStore.getState().app.qAPPAutoAuth}></mwc-checkbox>
								</div>
							</div>
						` : ''}

						${type === actions.PUBLISH_MULTIPLE_QDN_RESOURCES ? `			
							<div class="modal-subcontainer">
								<p class="modal-paragraph">${get("browserpage.bchange19")}</p>
								<p style="font-size: 16px;overflow-wrap: anywhere;" class="modal-paragraph"><span style="font-weight: bold">${get("browserpage.bchange45")}:</span> ${data.encrypt ? true : false}</p>
								<table>
									${data.resources.map((resource) => `
										<tr>
											<td><span style="font-weight: bold">${get("browserpage.bchange30")}:</span> ${resource.service}</td>
											<td><span style="font-weight: bold">${get("browserpage.bchange31")}:</span> ${resource.name}</td>
											<td><span style="font-weight: bold">${get("browserpage.bchange32")}:</span> ${resource.identifier}</td>
											${resource.filename ? `<td><span style="font-weight: bold">${get("browserpage.bchange34")}:</span> ${resource.filename}</td>` : ''}
										</tr>
									`).join('')}
								</table>
								<div class="checkbox-row">
									<label for="isWithFee" id="isWithFeeLabel" style="color: var(--black);">
										${get('browserpage.bchange33')} ${data.resources.length * 0.001} QORT fee
									</label>
									<mwc-checkbox checked style="margin-right: -15px;" id="isWithFee"></mwc-checkbox>
								</div>
							</div>
						` : ''}

						${type === actions.PUBLISH_QDN_RESOURCE ? `
							<div class="modal-subcontainer">
								<p class="modal-paragraph">${get("browserpage.bchange19")}</p>
								<p style="font-size: 16px;overflow-wrap: anywhere;" class="modal-paragraph"><span style="font-weight: bold">${get("browserpage.bchange30")}:</span> ${data.service}</p>
								<p style="font-size: 16px;overflow-wrap: anywhere;" class="modal-paragraph"><span style="font-weight: bold">${get("browserpage.bchange31")}:</span> ${data.name}</p>
								<p style="font-size: 16px;overflow-wrap: anywhere;" class="modal-paragraph"><span style="font-weight: bold">${get("browserpage.bchange32")}:</span> ${data.identifier}</p>
								<p style="font-size: 16px;overflow-wrap: anywhere;" class="modal-paragraph"><span style="font-weight: bold">${get("browserpage.bchange45")}:</span> ${data.encrypt ? true : false}</p>
								<div class="checkbox-row">
									<label for="isWithFee" id="isWithFeeLabel" style="color: var(--black);">
										${get('browserpage.bchange29')}
									</label>
									<mwc-checkbox checked style="margin-right: -15px;" id="isWithFee"></mwc-checkbox>
								</div>
							</div>
						` : ''}

						${type === actions.SEND_COIN ? `
							<div class="modal-subcontainer">
								<p class="modal-paragraph">${get("browserpage.bchange35")}</p>
								<p style="font-size: 16px;overflow-wrap: anywhere;" class="modal-paragraph"><span style="font-weight: bold">${get("walletpage.wchange59")}:</span> ${data.coin}</p>
								<p style="font-size: 16px;overflow-wrap: anywhere;" class="modal-paragraph"><span style="font-weight: bold">${get("walletpage.wchange19")}:</span> ${data.balance} ${data.coin}</p>
								<p style="font-size: 16px;overflow-wrap: anywhere;" class="modal-paragraph"><span style="font-weight: bold">${get("walletpage.wchange10")}:</span> ${data.recipient}</p>
								<p style="font-size: 16px;overflow-wrap: anywhere;" class="modal-paragraph"><span style="font-weight: bold">${get("walletpage.wchange11")}:</span> ${data.amount} ${data.coin}</p>
							</div>
						` : ''}

						${type === actions.GET_WALLET_BALANCE ? `
							<div class="modal-subcontainer">
								<p class="modal-paragraph">${get("browserpage.bchange20")}</p>
							</div>
						` : ''}
						${type === actions.GET_LIST_ITEMS ? `
							<div class="modal-subcontainer">
								<p class="modal-paragraph">${get("browserpage.bchange41")}</p>
								<p class="modal-paragraph">${get("browserpage.bchange40")}: <span> ${data.list_name}</span></p>
								<div class="checkbox-row">
									<label for="listsButton" id="listsButtonLabel" style="color: var(--black);">
										${get('browserpage.bchange39')}
									</label>
									<mwc-checkbox style="margin-right: -15px;" id="listsButton" ?checked=${window.parent.reduxStore.getState().app.qAPPAutoLists}></mwc-checkbox>
								</div>
							</div>
						` : ''}
						${type === actions.ADD_LIST_ITEMS ? `
							<div class="modal-subcontainer">
								<p class="modal-paragraph">${get("browserpage.bchange43")}</p>
								<p class="modal-paragraph">${get("browserpage.bchange40")}: <span> ${data.list_name}</span></p>
								<p class="modal-paragraph">${get("browserpage.bchange42")}: <span> ${data.items.join(', ')}</span></p>
							</div>
						` : ''}
						${type === actions.SAVE_FILE ? `
							<div class="modal-subcontainer">
								<p class="modal-paragraph">${get("browserpage.bchange46")}: <span> ${data.filename}</span></p>
							</div>
						` : ''}
						
						${type === actions.DELETE_LIST_ITEM ? `
							<div class="modal-subcontainer">
								<p class="modal-paragraph">${get("browserpage.bchange44")}</p>
								<p class="modal-paragraph">${get("browserpage.bchange40")}: <span> ${data.list_name}</span></p>
								<p class="modal-paragraph">${get("browserpage.bchange42")}: <span> ${data.item}</span></p>
							</div>
						` : ''}
						${type === actions.SEND_CHAT_MESSAGE ? `
							<p class="modal-paragraph">${get("browserpage.bchange22")}</p>
						` : ''}
					</div>
					<div class="modal-buttons">
						<button id="cancel-button">${get("browserpage.bchange27")}</button>
						<button id="ok-button">${get("browserpage.bchange28")}</button>
					</div>
				</div>
			</div>
		`;
		document.body.appendChild(modal);

		// Add click event listeners to the buttons
		const okButton = modal.querySelector('#ok-button');
		okButton.addEventListener('click', () => {
			const userData = {};
			if (type === actions.PUBLISH_QDN_RESOURCE || type === actions.PUBLISH_MULTIPLE_QDN_RESOURCES) {
				const isWithFeeCheckbox = modal.querySelector('#isWithFee');
				userData.isWithFee = isWithFeeCheckbox.checked;
			}
			if (modal.parentNode === document.body) {
				document.body.removeChild(modal);
			}
			resolve({ action: 'accept', userData });
		});
		const modalContent = modal.querySelector('.modal-content');
		modalContent.addEventListener('click', (e) => {
			e.stopPropagation();
			return;
		});
		const backdropClick = document.getElementById('backdrop');
		backdropClick.addEventListener('click', () => {
			if (modal.parentNode === document.body) {
				document.body.removeChild(modal);
			}
			resolve({ action: 'reject' });
		});
		const cancelButton = modal.querySelector('#cancel-button');
		cancelButton.addEventListener('click', () => {
			if (modal.parentNode === document.body) {
				document.body.removeChild(modal);
			}
			resolve({ action: 'reject' });
		});
		const labelButton = modal.querySelector('#authButtonLabel');
		if (labelButton) {
			labelButton.addEventListener('click', () => {
				this.shadowRoot.getElementById('authButton').click();
			})
		}
		const checkbox = modal.querySelector('#authButton');
		if (checkbox) {
			checkbox.addEventListener('click', (e) => {
				if (e.target.checked) {
					window.parent.reduxStore.dispatch(window.parent.reduxAction.removeQAPPAutoAuth(false))
					return
				}
				window.parent.reduxStore.dispatch(window.parent.reduxAction.allowQAPPAutoAuth(true))
			})
		}
		const labelButton2 = modal.querySelector('#listsButtonLabel');
		if (labelButton2) {
			labelButton2.addEventListener('click', () => {
				this.shadowRoot.getElementById('listsButton').click();
			})
		}
		const checkbox2 = modal.querySelector('#listsButton');
		if (checkbox2) {
			checkbox2.addEventListener('click', (e) => {
				if (e.target.checked) {
					window.parent.reduxStore.dispatch(window.parent.reduxAction.removeQAPPAutoLists(false))
					return
				}
				window.parent.reduxStore.dispatch(window.parent.reduxAction.allowQAPPAutoLists(true))
			})
		}
	});
}

async function showErrorAndWait(type, data, data1) {
	// Create the modal and add it to the DOM
	const modalDelay = ms => new Promise(res => setTimeout(res, ms))
	const error = document.createElement('div');
	error.id = "backdrop"
	error.classList.add("backdrop");
	error.innerHTML = `
		<div class="modal my-modal-class">
			<div class="modal-content">
				<div class="modal-body">

					${type === "MISSING_FIELDS" ? `
						<div class="modal-subcontainer-error">
							<p class="modal-paragraph-error">${data}</p>
							<p class="modal-paragraph-error">${data1}<</p>
						</div>
					` : ''}

					${type === "FAILED_FETCH" ? `
						<div class="modal-subcontainer-error">
							<p class="modal-paragraph-error">${data}</p>
							<p class="modal-paragraph-error">${data1}</p>
						</div>
					` : ''}

					${type === "INSSUFFICIENT_FUNDS" ? `
						<div class="modal-subcontainer-error">
							<p class="modal-paragraph-error">${data}</p>
							<p class="modal-paragraph-error">${data1}</p>
						</div>
					` : ''}

					${type === "INVALID_AMOUNT" ? `
						<div class="modal-subcontainer-error">
							<p class="modal-paragraph-error">${data}</p>
							<p class="modal-paragraph-error">${data1}</p>
						</div>
					` : ''}

					${type === "NO_RECEIVER" ? `
						<div class="modal-subcontainer-error">
							<p class="modal-paragraph-error">${data}</p>
							<p class="modal-paragraph-error">${data1}</p>
						</div>
					` : ''}

					${type === "INVALID_RECEIVER" ? `
						<div class="modal-subcontainer-error">
							<p class="modal-paragraph-error">${data}</p>
							<p class="modal-paragraph-error">${data1}</p>
						</div>
					` : ''}

					${type === "DECLINED_REQUEST" ? `
						<div class="modal-subcontainer-error">
							<p class="modal-paragraph-error">${data}</p>
							<p class="modal-paragraph-error">${data1}</p>
						</div>
					` : ''}

					${type === "TRANSACTION_FAILED" ? `
						<div class="modal-subcontainer-error">
							<p class="modal-paragraph-error">${data}</p>
							<p class="modal-paragraph-error">${data1}</p>
						</div>
					` : ''}

					${type === "TRANSACTION_SUCCESS" ? `
						<div class="modal-subcontainer-error">
							<p class="modal-paragraph-error">${data}</p>
							<p class="modal-paragraph-error">${data1}</p>
						</div>
					` : ''}

				</div>
			</div>
		</div>
	`;
	document.body.appendChild(error)

	await modalDelay(3000)
	document.body.removeChild(error)
}

// Add the styles for the modal
const styles = `
	* {
		--mdc-theme-primary: rgb(3, 169, 244);
		--mdc-theme-secondary: var(--mdc-theme-primary);
		--paper-input-container-focus-color: var(--mdc-theme-primary);
		--mdc-checkbox-unchecked-color: var(--black);
		--mdc-theme-on-surface: var(--black);
		--mdc-checkbox-disabled-color: var(--black);
		--mdc-checkbox-ink-color: var(--black);
	}

	.backdrop {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgb(186 186 186 / 26%);
		overflow: hidden;
		animation: backdrop_blur cubic-bezier(0.22, 1, 0.36, 1) 1s forwards; 
		z-index: 1000000;
	}

	@keyframes backdrop_blur {
		0% {
			backdrop-filter: blur(0px);
			background: transparent;
		}
		100% { 
			backdrop-filter: blur(5px);
			background: rgb(186 186 186 / 26%);
		}
	}

	@keyframes modal_transition {
		0% {
			visibility: hidden;
			opacity: 0;
	}
		100% {
			visibility: visible;
			opacity: 1;
		}
	}

	.modal {
		position: relative;
		display: flex;
		justify-content: center;
		align-items: center;
		width: 100%;
		height: 100%;
		animation: 1s cubic-bezier(0.22, 1, 0.36, 1) 0s 1 normal forwards running modal_transition;
		z-index: 1000001;
	}

	@keyframes modal_transition {
		0% {
			visibility: hidden;
			opacity: 0;
		}
		100% {
			visibility: visible;
			opacity: 1;
		}
	}

	.modal-content {
		background-color: var(--white);
		border-radius: 10px;
		padding: 20px;
		box-shadow: 0 0 10px rgba(0, 0, 0, 0.3);
		max-width: 80%;
		min-width: 300px;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
	}

	.modal-body {
		padding: 25px;
	}

	.modal-subcontainer {
		color: var(--black);
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 15px;
	}

	.modal-subcontainer-error {
		color: var(--black);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 15px;
	}

	.modal-paragraph-error {
		font-family: Roboto, sans-serif;
		font-size: 20px;
		letter-spacing: 0.3px;
		font-weight: 700;
		color: var(--black);
		margin: 0;
	}

	.modal-paragraph {
		font-family: Roboto, sans-serif;
		font-size: 18px;
		letter-spacing: 0.3px;
		font-weight: 300;
		color: var(--black);
		margin: 0;
		word-wrap: break-word; 
  		overflow-wrap: break-word;
	}

	.capitalize-first {
		text-transform: capitalize;
	}

	.checkbox-row {
		display: flex;
		align-items: center;
		font-family: Montserrat, sans-serif;
		font-weight: 600;
		color: var(--black);
	}

	.modal-buttons {
		display: flex;
		justify-content: space-between;
		margin-top: 20px;
	}

	.modal-buttons button {
		background-color: #4caf50;
		border: none;
		color: #fff;
		padding: 10px 20px;
		border-radius: 5px;
		cursor: pointer;
		transition: background-color 0.2s;
	}

	.modal-buttons button:hover {
		background-color: #3e8e41;
	}

	#cancel-button {
		background-color: #f44336;
	}

	#cancel-button:hover {
		background-color: #d32f2f;
	}
`;

const styleSheet = new CSSStyleSheet();
styleSheet.replaceSync(styles);

document.adoptedStyleSheets = [styleSheet];
