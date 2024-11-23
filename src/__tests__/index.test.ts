import ImgfansClient from '../index';

describe('ImgfansClient', () => {
    let client: ImgfansClient;

    beforeEach(() => {
        client = new ImgfansClient({ token: 'test-token' });
    });

    it('should create an instance with token', () => {
        expect(client).toBeInstanceOf(ImgfansClient);
    });

    it('should throw error if token is missing', () => {
        expect(() => {
            // @ts-ignore
            new ImgfansClient({});
        }).toThrow('API token is required');
    });
});