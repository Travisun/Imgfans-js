import axios, { AxiosInstance, AxiosResponse } from 'axios';
import FormData from 'form-data';
import { createReadStream, existsSync } from 'fs';
import { basename } from 'path';
import { Readable } from 'stream';

interface ImgfansConfig {
    token: string;
    baseURL?: string;
}

interface ImgfansResponse {
    success: boolean;
    file: {
        id: string;
        name: string;
        size: number;
        mime_type: string;
        url: string;
        downloadUrl: string;
        thumbnailUrl: string;
        references: {
            direct_link: { label: string; code: string; };
            download_link: { label: string; code: string; };
            bbcode: { label: string; code: string; };
            html: { label: string; code: string; };
            markdown: { label: string; code: string; };
        };
        expires_at: string | null;
    };
}

type UploadInput =
    | string  // URL, file path, or base64
    | Buffer
    | Blob
    | Readable;

class ImgfansError extends Error {
    constructor(
        message: string,
        public statusCode?: number,
        public response?: any,
        public cause?: Error
    ) {
        super(message);
        this.name = 'ImgfansError';
    }

    static fromError(error: any): ImgfansError {
        if (axios.isAxiosError(error)) {
            const statusCode = error.response?.status;
            const message = this.getReadableErrorMessage(error);
            return new ImgfansError(message, statusCode, error.response?.data, error);
        }
        return new ImgfansError(
            error.message || 'An unexpected error occurred',
            undefined,
            undefined,
            error
        );
    }

    private static getReadableErrorMessage(error: any): string {
        if (error.response?.status === 413) {
            return 'The image file is too large. Please try a smaller file.';
        }
        if (error.response?.status === 415) {
            return 'The file type is not supported. Please upload a valid image file.';
        }
        if (error.response?.status === 401) {
            return 'Invalid or missing API token. Please check your credentials.';
        }
        if (error.code === 'ECONNREFUSED') {
            return 'Unable to connect to Imgfans server. Please check your internet connection.';
        }
        return error.response?.data?.message || error.message || 'Upload failed for unknown reason';
    }
}

export class ImgfansClient {
    private client: AxiosInstance;
    private readonly DEFAULT_BASE_URL = 'https://imgfans.com/api/v1';
    private readonly SUPPORTED_MIME_TYPES = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/svg+xml'
    ];

    constructor(config: ImgfansConfig) {
        if (!config.token) {
            throw new ImgfansError('API token is required for initialization');
        }

        this.client = axios.create({
            baseURL: config.baseURL || this.DEFAULT_BASE_URL,
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Accept': 'application/json',
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        });

        this.client.interceptors.response.use(
            response => response,
            error => {
                throw ImgfansError.fromError(error);
            }
        );
    }

    /**
     * Upload an image to Imgfans with automatic input type detection
     * @param input - URL, file path, base64 string, Buffer, Blob, or ReadableStream
     * @param filename - Optional custom filename
     * @returns Promise with upload response
     */
    async upload(input: UploadInput, filename?: string): Promise<ImgfansResponse> {
        try {
            const { processedFile, detectedFilename } = await this.preprocessInput(input, filename);
            return await this.performUpload(processedFile, detectedFilename);
        } catch (error) {
            throw ImgfansError.fromError(error);
        }
    }

    private async preprocessInput(input: UploadInput, customFilename?: string): Promise<{
        processedFile: Buffer | Readable | Blob,
        detectedFilename: string
    }> {
        try {
            // Handle string input (URL, file path, or base64)
            if (typeof input === 'string') {
                // Check if it's a URL
                if (input.startsWith('http://') || input.startsWith('https://')) {
                    const response = await axios.get(input, { responseType: 'arraybuffer' });
                    const buffer = Buffer.from(response.data);
                    return {
                        processedFile: buffer,
                        detectedFilename: customFilename || basename(new URL(input).pathname)
                    };
                }

                // Check if it's a base64 string
                if (input.startsWith('data:image/')) {
                    const matches = input.match(/^data:(.+);base64,(.+)$/);
                    if (matches) {
                        const buffer = Buffer.from(matches[2], 'base64');
                        return {
                            processedFile: buffer,
                            detectedFilename: customFilename || 'image.png'
                        };
                    }
                }

                // Check if it's a file path
                if (existsSync(input)) {
                    return {
                        processedFile: createReadStream(input),
                        detectedFilename: customFilename || basename(input)
                    };
                }

                throw new ImgfansError('Invalid input: must be a valid URL, file path, or base64 string');
            }

            // Handle Buffer
            if (Buffer.isBuffer(input)) {
                return {
                    processedFile: input,
                    detectedFilename: customFilename || 'image.png'
                };
            }

            // Handle Blob
            if (input instanceof Blob) {
                return {
                    processedFile: input,
                    detectedFilename: customFilename || 'image.png'
                };
            }

            // Handle ReadableStream
            if (input instanceof Readable) {
                return {
                    processedFile: input,
                    detectedFilename: customFilename || 'image.png'
                };
            }

            throw new ImgfansError('Unsupported input type');
        } catch (error) {
            throw ImgfansError.fromError(error);
        }
    }

    private async performUpload(
        file: Buffer | Readable | Blob,
        filename: string
    ): Promise<ImgfansResponse> {
        const formData = new FormData();
        formData.append('file', file, filename);

        try {
            const response: AxiosResponse<ImgfansResponse> = await this.client.post(
                '/upload',
                formData,
                {
                    headers: {
                        ...formData.getHeaders(),
                    },
                }
            );

            return response.data;
        } catch (error) {
            throw ImgfansError.fromError(error);
        }
    }

    /**
     * Get direct link for the uploaded image
     * @param response - Upload response from upload method
     * @returns Direct link URL
     */
    getDirectLink(response: ImgfansResponse): string {
        this.validateResponse(response);
        return response.file.references.direct_link.code;
    }

    /**
     * Get markdown code for the uploaded image
     * @param response - Upload response from upload method
     * @returns Markdown code
     */
    getMarkdownCode(response: ImgfansResponse): string {
        this.validateResponse(response);
        return response.file.references.markdown.code;
    }

    /**
     * Get HTML code for the uploaded image
     * @param response - Upload response from upload method
     * @returns HTML code
     */
    getHtmlCode(response: ImgfansResponse): string {
        this.validateResponse(response);
        return response.file.references.html.code;
    }

    /**
     * Get all reference codes for the uploaded image
     * @param response - Upload response from upload method
     * @returns Object containing all reference codes
     */
    getAllReferences(response: ImgfansResponse): Record<string, string> {
        this.validateResponse(response);
        const refs = response.file.references;
        return {
            directLink: refs.direct_link.code,
            downloadLink: refs.download_link.code,
            bbcode: refs.bbcode.code,
            html: refs.html.code,
            markdown: refs.markdown.code
        };
    }

    private validateResponse(response: ImgfansResponse) {
        if (!response?.file?.references) {
            throw new ImgfansError('Invalid response format from server');
        }
    }
}

export default ImgfansClient;