/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotebookRegistry } from 'vs/workbench/contrib/notebook/browser/notebookRegistry';
import * as DOM from 'vs/base/browser/dom';
import { ICellOutputViewModel, ICommonNotebookEditor, IOutputTransformContribution, IRenderOutput, RenderOutputType } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { isArray } from 'vs/base/common/types';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { URI } from 'vs/base/common/uri';
import { MarkdownRenderer } from 'vs/editor/browser/core/markdownRenderer';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { dirname } from 'vs/base/common/resources';
import { truncatedArrayOfString } from 'vs/workbench/contrib/notebook/browser/view/output/transforms/textHelper';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { ErrorTransform } from 'vs/workbench/contrib/notebook/browser/view/output/transforms/errorTransform';

class RichRenderer implements IOutputTransformContribution {
	private _richMimeTypeRenderers = new Map<string, (output: ICellOutputViewModel, notebookUri: URI, container: HTMLElement) => IRenderOutput>();

	constructor(
		public notebookEditor: ICommonNotebookEditor,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IModelService private readonly modelService: IModelService,
		@IModeService private readonly modeService: IModeService,
		@IThemeService private readonly themeService: IThemeService,
		@IOpenerService readonly openerService: IOpenerService,
		@ITextFileService readonly textFileService: ITextFileService,
	) {
		this._richMimeTypeRenderers.set('application/json', this.renderJSON.bind(this));
		this._richMimeTypeRenderers.set('application/javascript', this.renderJavaScript.bind(this));
		this._richMimeTypeRenderers.set('text/html', this.renderHTML.bind(this));
		this._richMimeTypeRenderers.set('image/svg+xml', this.renderSVG.bind(this));
		this._richMimeTypeRenderers.set('text/markdown', this.renderMarkdown.bind(this));
		this._richMimeTypeRenderers.set('image/png', this.renderPNG.bind(this));
		this._richMimeTypeRenderers.set('image/jpeg', this.renderJPEG.bind(this));
		this._richMimeTypeRenderers.set('text/plain', this.renderPlainText.bind(this));
		this._richMimeTypeRenderers.set('text/x-javascript', this.renderCode.bind(this));
		this._richMimeTypeRenderers.set('application/x.notebook.error-traceback', this._renderErrorTraceback.bind(this));
		this._richMimeTypeRenderers.set('application/x.notebook.stream', this._renderStream.bind(this));
	}

	render(output: ICellOutputViewModel, container: HTMLElement, preferredMimeType: string | undefined, notebookUri: URI): IRenderOutput {
		if (!output.model.data) {
			const contentNode = document.createElement('p');
			contentNode.innerText = `No data could be found for output.`;
			container.appendChild(contentNode);
			return { type: RenderOutputType.None, hasDynamicHeight: false };
		}

		if (!preferredMimeType || !this._richMimeTypeRenderers.has(preferredMimeType)) {
			const contentNode = document.createElement('p');
			const mimeTypes = [];
			for (const property in output.model.data) {
				mimeTypes.push(property);
			}

			const mimeTypesMessage = mimeTypes.join(', ');

			if (preferredMimeType) {
				contentNode.innerText = `No renderer could be found for MIME type: ${preferredMimeType}`;
			} else {
				contentNode.innerText = `No renderer could be found for output. It has the following MIME types: ${mimeTypesMessage}`;
			}

			container.appendChild(contentNode);
			return { type: RenderOutputType.None, hasDynamicHeight: false };
		}

		const renderer = this._richMimeTypeRenderers.get(preferredMimeType);
		return renderer!(output, notebookUri, container);
	}

	renderJSON(output: ICellOutputViewModel, notebookUri: URI, container: HTMLElement): IRenderOutput {
		const data = output.model.data['application/json'];
		const str = JSON.stringify(data, null, '\t');

		const editor = this.instantiationService.createInstance(CodeEditorWidget, container, {
			...getOutputSimpleEditorOptions(),
			dimension: {
				width: 0,
				height: 0
			}
		}, {
			isSimpleWidget: true
		});

		const mode = this.modeService.create('json');
		const resource = URI.parse(`notebook-output-${Date.now()}.json`);
		const textModel = this.modelService.createModel(str, mode, resource, false);
		editor.setModel(textModel);

		const width = this.notebookEditor.getCellOutputLayoutInfo(output.cellViewModel).width;
		const fontInfo = this.notebookEditor.getCellOutputLayoutInfo(output.cellViewModel).fontInfo;
		const height = Math.min(textModel.getLineCount(), 16) * (fontInfo.lineHeight || 18);

		editor.layout({
			height,
			width
		});

		container.style.height = `${height + 16}px`;

		return { type: RenderOutputType.None, hasDynamicHeight: true };
	}

	renderCode(output: ICellOutputViewModel, notebookUri: URI, container: HTMLElement): IRenderOutput {
		const data = output.model.data['text/x-javascript'];
		const str = (isArray(data) ? data.join('') : data) as string;

		const editor = this.instantiationService.createInstance(CodeEditorWidget, container, {
			...getOutputSimpleEditorOptions(),
			dimension: {
				width: 0,
				height: 0
			}
		}, {
			isSimpleWidget: true
		});

		const mode = this.modeService.create('javascript');
		const resource = URI.parse(`notebook-output-${Date.now()}.js`);
		const textModel = this.modelService.createModel(str, mode, resource, false);
		editor.setModel(textModel);

		const width = this.notebookEditor.getCellOutputLayoutInfo(output.cellViewModel).width;
		const fontInfo = this.notebookEditor.getCellOutputLayoutInfo(output.cellViewModel).fontInfo;
		const height = Math.min(textModel.getLineCount(), 16) * (fontInfo.lineHeight || 18);

		editor.layout({
			height,
			width
		});

		container.style.height = `${height + 16}px`;

		return { type: RenderOutputType.None, hasDynamicHeight: true };
	}

	renderJavaScript(output: ICellOutputViewModel, notebookUri: URI, container: HTMLElement): IRenderOutput {
		const data = output.model.data['application/javascript'];
		const str = isArray(data) ? data.join('') : data;
		const scriptVal = `<script type="application/javascript">${str}</script>`;
		return {
			type: RenderOutputType.Html,
			source: output,
			htmlContent: scriptVal,
			hasDynamicHeight: false
		};
	}

	renderHTML(output: ICellOutputViewModel, notebookUri: URI, container: HTMLElement): IRenderOutput {
		const data = output.model.data['text/html'];
		const str = (isArray(data) ? data.join('') : data) as string;
		return {
			type: RenderOutputType.Html,
			source: output,
			htmlContent: str,
			hasDynamicHeight: false
		};
	}

	renderSVG(output: ICellOutputViewModel, notebookUri: URI, container: HTMLElement): IRenderOutput {
		const data = output.model.data['image/svg+xml'];
		const str = (isArray(data) ? data.join('') : data) as string;
		return {
			type: RenderOutputType.Html,
			source: output,
			htmlContent: str,
			hasDynamicHeight: false
		};
	}

	renderMarkdown(output: ICellOutputViewModel, notebookUri: URI, container: HTMLElement): IRenderOutput {
		const data = output.model.data['text/markdown'];
		const str = (isArray(data) ? data.join('') : data) as string;
		const mdOutput = document.createElement('div');
		const mdRenderer = this.instantiationService.createInstance(MarkdownRenderer, { baseUrl: dirname(notebookUri) });
		mdOutput.appendChild(mdRenderer.render({ value: str, isTrusted: true, supportThemeIcons: true }, undefined, { gfm: true }).element);
		container.appendChild(mdOutput);

		return { type: RenderOutputType.None, hasDynamicHeight: true };
	}

	renderPNG(output: ICellOutputViewModel, notebookUri: URI, container: HTMLElement): IRenderOutput {
		const image = document.createElement('img');
		image.src = `data:image/png;base64,${output.model.data['image/png']}`;
		const display = document.createElement('div');
		display.classList.add('display');
		display.appendChild(image);
		container.appendChild(display);
		return { type: RenderOutputType.None, hasDynamicHeight: true };
	}

	renderJPEG(output: ICellOutputViewModel, notebookUri: URI, container: HTMLElement): IRenderOutput {
		const image = document.createElement('img');
		image.src = `data:image/jpeg;base64,${output.model.data['image/jpeg']}`;
		const display = document.createElement('div');
		display.classList.add('display');
		display.appendChild(image);
		container.appendChild(display);
		return { type: RenderOutputType.None, hasDynamicHeight: true };
	}

	renderPlainText(output: ICellOutputViewModel, notebookUri: URI, container: HTMLElement): IRenderOutput {
		const data = output.model.data['text/plain'];
		const contentNode = DOM.$('.output-plaintext');
		truncatedArrayOfString(contentNode, isArray(data) ? data : [data], this.openerService, this.textFileService, this.themeService);
		container.appendChild(contentNode);

		return { type: RenderOutputType.None, hasDynamicHeight: false };
	}

	private _renderErrorTraceback(outputViewModel: ICellOutputViewModel, _notebookUri: URI, container: HTMLElement): IRenderOutput {
		const output = outputViewModel.model.data['application/x.notebook.error-traceback'] as any;
		ErrorTransform.render(output, container, this.themeService);
		return { type: RenderOutputType.None, hasDynamicHeight: false };
	}

	private _renderStream(outputViewModel: ICellOutputViewModel, _notebookUri: URI, container: HTMLElement): IRenderOutput {
		const data = outputViewModel.model.data['application/x.notebook.stream'] as any;
		const text = (isArray(data) ? data.join('') : data) as string;
		const contentNode = DOM.$('span.output-stream');
		truncatedArrayOfString(contentNode, [text], this.openerService, this.textFileService, this.themeService);
		container.appendChild(contentNode);
		return { type: RenderOutputType.None, hasDynamicHeight: false };
	}

	dispose(): void {
	}
}


NotebookRegistry.registerOutputTransform('notebook.output.rich', RichRenderer);


export function getOutputSimpleEditorOptions(): IEditorOptions {
	return {
		readOnly: true,
		wordWrap: 'on',
		overviewRulerLanes: 0,
		glyphMargin: false,
		selectOnLineNumbers: false,
		hideCursorInOverviewRuler: true,
		selectionHighlight: false,
		lineDecorationsWidth: 0,
		overviewRulerBorder: false,
		scrollBeyondLastLine: false,
		renderLineHighlight: 'none',
		minimap: {
			enabled: false
		},
		lineNumbers: 'off',
		scrollbar: {
			alwaysConsumeMouseWheel: false
		}
	};
}
